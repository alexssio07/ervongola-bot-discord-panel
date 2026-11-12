"""
Report di confronto fra il forum Discord dei film e il catalogo del pannello
(pulsante "Sincronizza forum"). NON importa e NON modifica nulla: legge i post
del forum e mostra, per ciascuno, se il film e' gia' nel catalogo.

Per ogni post (thread) del forum:
  - titolo del post -> titolo del film cercato nel catalogo;
  - tag del post    -> stato nel forum: visto / da guardare (gli altri tag sono ignorati);
  - confronto con il catalogo: UGUALE (stesso titolo ignorando maiuscole, accenti,
    punteggiatura e articoli), SIMILE (titolo scritto in modo un po' diverso, con
    punteggio di somiglianza) oppure NON PRESENTE;
  - se il film c'e' ma lo stato e' diverso, e' segnalato.
Un titolo con piu' capitoli ("Iron Man 1-2-3-4") e' letto come un film per capitolo,
solo per il confronto. In piu' l'elenco dei film del catalogo senza un post nel forum.

Il pannello parla con l'API REST di Discord usando il DISCORD_TOKEN del bot
(stesso container): non serve discord.py e non si tocca il codice del bot.
"""

import difflib
import logging
import re
import threading
import time
import unicodedata

import requests
from flask import Blueprint, jsonify, request

import config
import db
from auth import require_auth

bp = Blueprint("forum_sync", __name__, url_prefix="/api/movies")
logger = logging.getLogger("panel.movies")

DISCORD_API = "https://discord.com/api/v10"
REQUEST_TIMEOUT = 8
FORUM_CHANNEL_TYPE = 15
THREADS_CACHE_TTL = 60
MAX_ARCHIVED_PAGES = 20
MAX_SEQUEL_NUMBER = 20
MAX_EXPANDED = 12

SIMILAR_MIN_SCORE = 0.75
MAX_MATCHES = 3
MAX_MISSING_IN_FORUM = 200

_cache_lock = threading.Lock()
_threads_cache: dict = {"at": 0.0, "value": None}

# "<titolo> 1-2-3-4", "<titolo> 1/2/3", "<titolo> 1, 2 e 3", "<titolo> 1 2 3", con eventuale "(...)" finale.
_SEPARATOR = r"(?:\s*[-–—/,&+]\s*|\s+e\s+|\s+and\s+|\s+)"
_SEQUEL_LIST = re.compile(
    rf"^(?P<base>.*?\S)\s+(?P<nums>\d{{1,2}}(?:{_SEPARATOR}\d{{1,2}})+)\s*(?:\([^)]*\))?\s*$"
)
_NOT_SEEN_WORDS = ("non visto", "da vedere", "da guardare", "non ancora", "unseen", "to watch")
_ARTICLES = {"il", "lo", "la", "i", "gli", "le", "l", "un", "una", "uno", "the", "a", "an"}


class DiscordError(Exception):
    pass


def _discord_get(path: str, params: dict | None = None) -> dict | list:
    headers = {"Authorization": f"Bot {config.DISCORD_TOKEN}"}
    for attempt in range(2):
        try:
            res = requests.get(f"{DISCORD_API}{path}", params=params, headers=headers, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as e:
            logger.warning("Discord non raggiungibile (%s)", type(e).__name__)
            raise DiscordError("Discord non raggiungibile.") from e
        if res.status_code == 429 and attempt == 0:
            time.sleep(min(float(res.json().get("retry_after", 1)), 5))  # rispetta il rate limit
            continue
        break
    if res.status_code == 401:
        raise DiscordError("Token del bot non valido.")
    if res.status_code == 403:
        raise DiscordError("Il bot non ha accesso al forum (servono i permessi Vedi canale e Leggi cronologia messaggi).")
    if res.status_code == 404:
        raise DiscordError("Forum non trovato: controlla l'id del canale.")
    if not res.ok:
        logger.warning("Discord ha risposto %s su %s", res.status_code, path.split("?")[0])
        raise DiscordError(f"Discord ha risposto con un errore ({res.status_code}).")
    return res.json()


def _fetch_threads(force: bool) -> dict:
    """Tutti i post del forum (attivi + archiviati) e i nomi dei tag.
    Messi in cache 60 s per non rifare le stesse richieste a Discord."""
    now = time.time()
    with _cache_lock:
        if not force and _threads_cache["value"] and now - _threads_cache["at"] < THREADS_CACHE_TTL:
            return _threads_cache["value"]

    channel_id = config.MOVIES_FORUM_CHANNEL_ID
    channel = _discord_get(f"/channels/{channel_id}")
    if channel.get("type") != FORUM_CHANNEL_TYPE:
        raise DiscordError("Il canale indicato non e' un forum.")
    tags = {t["id"]: t["name"] for t in channel.get("available_tags", [])}

    threads: dict[str, dict] = {}
    active = _discord_get(f"/guilds/{channel['guild_id']}/threads/active")
    for t in active.get("threads", []):
        if t.get("parent_id") == channel_id:
            threads[t["id"]] = t

    before = None
    for _ in range(MAX_ARCHIVED_PAGES):
        params = {"limit": 100}
        if before:
            params["before"] = before
        page = _discord_get(f"/channels/{channel_id}/threads/archived/public", params)
        for t in page.get("threads", []):
            threads[t["id"]] = t
        if not page.get("has_more") or not page.get("threads"):
            break
        before = page["threads"][-1]["thread_metadata"]["archive_timestamp"]

    value = {"threads": sorted(threads.values(), key=lambda t: int(t["id"])), "tags": tags}
    with _cache_lock:
        _threads_cache.update(at=now, value=value)
    return value


def status_from_tags(tag_names: list[str]) -> str:
    """"da_guardare" se un tag dice che non e' stato visto, "visto" se dice visto; altrimenti da guardare."""
    names = [n.casefold() for n in tag_names]
    if any(w in n for n in names for w in _NOT_SEEN_WORDS):
        return "da_guardare"
    if any("visto" in n or "watched" in n for n in names):
        return "visto"
    return "da_guardare"


def expand_titles(title: str) -> list[str]:
    """"Iron Man 1-2-3-4" -> ["Iron Man", "Iron Man 2", "Iron Man 3", "Iron Man 4"].

    Il capitolo 1 prende il solo titolo base. Con due soli numeri uniti da un
    trattino ("Ip Man 1-4") si intende l'intervallo; con piu' numeri vale
    l'elenco scritto. Numeri non crescenti, troppi o grandi (anni, "Apollo 13"):
    il titolo non si tocca. Un solo numero ("Iron Man 2") resta com'e'."""
    match = _SEQUEL_LIST.match(title.strip())
    if not match:
        return [title.strip()]
    base = match.group("base").rstrip(" -–—:,")
    numbers = [int(n) for n in re.findall(r"\d+", match.group("nums"))]

    only_dash = re.fullmatch(r"\s*[-–—]\s*", re.sub(r"\d+", "", match.group("nums")))
    if len(numbers) == 2 and only_dash and numbers[1] > numbers[0]:
        numbers = list(range(numbers[0], numbers[1] + 1))

    increasing = all(a < b for a, b in zip(numbers, numbers[1:]))
    if not base or not increasing or len(numbers) > MAX_EXPANDED or max(numbers) > MAX_SEQUEL_NUMBER:
        return [title.strip()]
    return [base if n == 1 else f"{base} {n}" for n in numbers]


def normalize_title(title: str) -> str:
    """Minuscolo, senza accenti, punteggiatura e articoli iniziali: "Il Padrino!" == "padrino"."""
    decomposed = unicodedata.normalize("NFKD", title.casefold())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    words = re.sub(r"[\W_]+", " ", stripped).split()
    while len(words) > 1 and words[0] in _ARTICLES:
        words = words[1:]
    return " ".join(words)


def title_score(a: str, b: str) -> float:
    """Somiglianza 0-1 fra due titoli gia' normalizzati: il migliore fra somiglianza dei
    caratteri (difflib) e sovrapposizione delle parole. Se i numeri nel titolo sono
    diversi ("Iron Man 2" / "Iron Man 3") sono film diversi: il punteggio scende."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    score = 0.0
    if matcher.real_quick_ratio() >= SIMILAR_MIN_SCORE and matcher.quick_ratio() >= SIMILAR_MIN_SCORE:
        score = matcher.ratio()
    words_a, words_b = set(a.split()), set(b.split())
    score = max(score, len(words_a & words_b) / len(words_a | words_b))
    if set(re.findall(r"\d+", a)) != set(re.findall(r"\d+", b)):
        score *= 0.6
    return round(score, 2)


def _best_matches(wanted: str, catalog: list[tuple[dict, str]]) -> list[dict]:
    scored = []
    for movie, normalized in catalog:
        score = title_score(wanted, normalized)
        if score >= SIMILAR_MIN_SCORE:
            scored.append({"id": movie["id"], "title": movie["title"], "status": movie["status"], "score": score})
    scored.sort(key=lambda m: -m["score"])
    return scored[:MAX_MATCHES]


def build_report(threads: list[dict], tags: dict[str, str], movies: list[dict]) -> dict:
    """Confronto post del forum <-> catalogo. Complessita' O(P * C) confronti brevi
    (P post, C film), con i filtri rapidi di difflib che scartano quasi tutto."""
    catalog = [(m, normalize_title(m["title"])) for m in movies]
    matched_movie_ids: set[int] = set()
    rows = []

    for thread in threads:
        post_title = (thread.get("name") or "").strip()
        if not post_title:
            continue
        tag_names = [tags[t] for t in thread.get("applied_tags", []) if t in tags]
        forum_status = status_from_tags(tag_names)
        titles = expand_titles(post_title)

        for title in titles:
            matches = _best_matches(normalize_title(title), catalog)
            kind = "uguale" if matches and matches[0]["score"] == 1.0 else "simile" if matches else "nuovo"
            if matches:  # il film migliore del confronto risulta "presente nel forum"
                matched_movie_ids.add(matches[0]["id"])
            rows.append(
                {
                    "post": post_title,
                    "title": title,
                    "from_multi": len(titles) > 1,
                    "tags": tag_names,
                    "forum_status": forum_status,
                    "kind": kind,
                    "matches": matches,
                    "status_differs": bool(matches) and matches[0]["status"] != forum_status,
                }
            )

    missing = [m["title"] for m in movies if m["id"] not in matched_movie_ids]
    return {
        "rows": rows,
        "missing_in_forum": missing[:MAX_MISSING_IN_FORUM],
        "missing_in_forum_total": len(missing),
    }


@bp.get("/forum-report")
@require_auth
def forum_report():
    if not config.DISCORD_TOKEN:
        return jsonify({"error": "DISCORD_TOKEN non disponibile nel pannello.", "code": "no_token"}), 503
    try:
        data = _fetch_threads(force=request.args.get("refresh") == "1")
    except DiscordError as e:
        return jsonify({"error": str(e), "code": "discord_failed"}), 502

    report = build_report(data["threads"], data["tags"], db.all_movie_titles())
    report["total_threads"] = len(data["threads"])
    report["tags"] = {name: status_from_tags([name]) for name in data["tags"].values()}
    return jsonify(report)
