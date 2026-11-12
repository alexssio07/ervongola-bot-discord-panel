"""
Ricerca automatica dei dati di un film (genere, anno, copertina) su TMDB,
usata dal form "Aggiungi film" mentre si scrive il titolo.

GET /api/movies/lookup?title=...  ->  {"results": [{tmdb_id, title, year, genre, cover_url}, ...]}

Il backend fa da proxy: la chiave TMDB resta sul server e non arriva mai al
browser. Le risposte sono messe in cache in RAM per non rifare la stessa
richiesta ad ogni tasto/ripetizione.
"""

import difflib
import logging
import re
import threading
import time

import requests
from flask import Blueprint, g, jsonify, request

import activity
import config
import db
from auth import require_auth

bp = Blueprint("movie_lookup", __name__, url_prefix="/api/movies")
logger = logging.getLogger("panel.movies")

TMDB_BASE = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p/w342"
LANGUAGE = "it-IT"
REQUEST_TIMEOUT = 5
MAX_RESULTS = 5
MIN_TITLE_LENGTH = 2

SEARCH_CACHE_TTL = 3600
SEARCH_CACHE_MAX = 200
GENRES_CACHE_TTL = 24 * 3600

_lock = threading.Lock()
_search_cache: dict[str, tuple[float, list[dict]]] = {}
_genres_cache: tuple[float, dict[int, str]] = (0.0, {})


_details_cache: dict[int, tuple[float, dict]] = {}
_COLLECTION_SUFFIX = re.compile(r"\s*[-–:]?\s*\(?\b(collezione|collection|saga|trilogia)\b\)?\s*$", re.IGNORECASE)


class LookupError_(Exception):
    pass


def _tmdb_get(path: str, params: dict) -> dict:
    headers = {}
    params = dict(params)
    if config.TMDB_API_KEY.startswith("eyJ"):  # Read Access Token (v4)
        headers["Authorization"] = f"Bearer {config.TMDB_API_KEY}"
    else:
        params["api_key"] = config.TMDB_API_KEY
    try:
        res = requests.get(f"{TMDB_BASE}{path}", params=params, headers=headers, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as e:
        # Il messaggio di requests puo' contenere l'URL con api_key: non lo logghiamo.
        logger.warning("TMDB non raggiungibile (%s)", type(e).__name__)
        raise LookupError_("Servizio di ricerca non raggiungibile.") from e
    if res.status_code in (401, 403):
        raise LookupError_("Chiave TMDB non valida.")
    if not res.ok:
        logger.warning("TMDB ha risposto %s", res.status_code)
        raise LookupError_("Il servizio di ricerca ha risposto con un errore.")
    return res.json()


def _genre_names() -> dict[int, str]:
    global _genres_cache
    now = time.time()
    with _lock:
        cached_at, genres = _genres_cache
        if genres and now - cached_at < GENRES_CACHE_TTL:
            return genres
    data = _tmdb_get("/genre/movie/list", {"language": LANGUAGE})
    genres = {g["id"]: g["name"] for g in data.get("genres", [])}
    with _lock:
        _genres_cache = (now, genres)
    return genres


def _search(title: str, language: str = LANGUAGE) -> list[dict]:
    key = f"{language}|{title.lower()}"
    now = time.time()
    with _lock:
        cached = _search_cache.get(key)
        if cached and now - cached[0] < SEARCH_CACHE_TTL:
            return cached[1]

    genres = _genre_names()
    data = _tmdb_get(
        "/search/movie",
        {"query": title, "language": language, "include_adult": "false", "page": 1},
    )
    results = []
    for item in data.get("results", [])[:MAX_RESULTS]:
        poster = item.get("poster_path")
        results.append(
            {
                "tmdb_id": item.get("id"),
                "title": item.get("title") or item.get("original_title") or "",
                "original_title": item.get("original_title") or "",
                "year": (item.get("release_date") or "")[:4],
                "genre": ", ".join(genres[g] for g in item.get("genre_ids", []) if g in genres),
                "cover_url": f"{IMAGE_BASE}{poster}" if poster else "",
            }
        )

    with _lock:
        if len(_search_cache) >= SEARCH_CACHE_MAX:
            _search_cache.pop(next(iter(_search_cache)))  # elimina la voce piu' vecchia
        _search_cache[key] = (now, results)
    return results


@bp.get("/lookup")
@require_auth
def lookup_movie():
    title = (request.args.get("title") or "").strip()
    if len(title) < MIN_TITLE_LENGTH:
        return jsonify({"results": []})

    if not config.TMDB_API_KEY:
        return jsonify({"error": "Ricerca automatica non attiva: TMDB_API_KEY non configurata.", "code": "no_key"}), 503

    try:
        return jsonify({"results": _search(title)})
    except LookupError_ as e:
        return jsonify({"error": str(e), "code": "lookup_failed"}), 502


def _clean_collection_name(name: str) -> str:
    """"Guardiani della Galassia - Collezione" -> "Guardiani della Galassia"."""
    cleaned = _COLLECTION_SUFFIX.sub("", name or "").strip()
    return cleaned or (name or "").strip()


def _details(tmdb_id: int) -> dict:
    """Saga (collection) e durata di un film, dalla scheda dettagliata di TMDB."""
    now = time.time()
    with _lock:
        cached = _details_cache.get(tmdb_id)
        if cached and now - cached[0] < SEARCH_CACHE_TTL:
            return cached[1]

    data = _tmdb_get(f"/movie/{tmdb_id}", {"language": LANGUAGE})
    collection = data.get("belongs_to_collection") or {}
    details = {
        "collection": _clean_collection_name(collection.get("name", "")) if collection else "",
        "runtime": int(data.get("runtime") or 0),  # minuti, 0 = sconosciuta
    }

    with _lock:
        if len(_details_cache) >= SEARCH_CACHE_MAX:
            _details_cache.pop(next(iter(_details_cache)))
        _details_cache[tmdb_id] = (now, details)
    return details


@bp.get("/lookup/details")
@require_auth
def lookup_details():
    try:
        tmdb_id = int(request.args.get("tmdb_id", ""))
    except ValueError:
        return jsonify({"error": "tmdb_id non valido."}), 400

    if not config.TMDB_API_KEY:
        return jsonify({"error": "Ricerca automatica non attiva: TMDB_API_KEY non configurata.", "code": "no_key"}), 503

    try:
        return jsonify(_details(tmdb_id))
    except LookupError_ as e:
        return jsonify({"error": str(e), "code": "lookup_failed"}), 502


def _normalize_title(title: str) -> str:
    return re.sub(r"[\W_]+", "", title.casefold())


PROVIDERS_CACHE_TTL = 6 * 3600
_providers_cache: dict[int, tuple[float, dict]] = {}
_PROVIDER_LOGO_BASE = "https://image.tmdb.org/t/p/w92"


def _providers(tmdb_id: int) -> dict:
    """Dove vedere il film nel paese configurato (TMDB, dati JustWatch).
    Cache 6 ore: le disponibilita' cambiano di rado e ogni apertura del popup
    non deve costare una richiesta."""
    now = time.time()
    with _lock:
        cached = _providers_cache.get(tmdb_id)
        if cached and now - cached[0] < PROVIDERS_CACHE_TTL:
            return cached[1]

    data = _tmdb_get(f"/movie/{tmdb_id}/watch/providers", {})
    region = (data.get("results") or {}).get(config.TMDB_WATCH_REGION) or {}

    def names(*keys):
        seen, out = set(), []
        for key in keys:
            for p in region.get(key, []):
                if p["provider_id"] in seen:
                    continue
                seen.add(p["provider_id"])
                logo = p.get("logo_path")
                out.append({"name": p["provider_name"], "logo": f"{_PROVIDER_LOGO_BASE}{logo}" if logo else ""})
        return out

    result = {
        "region": config.TMDB_WATCH_REGION,
        "link": region.get("link", ""),  # pagina JustWatch con tutte le opzioni
        "flatrate": names("flatrate"),  # incluso nell'abbonamento
        "free": names("free", "ads"),  # gratis (con pubblicita')
        "rent": names("rent"),
        "buy": names("buy"),
    }
    with _lock:
        if len(_providers_cache) >= SEARCH_CACHE_MAX:
            _providers_cache.pop(next(iter(_providers_cache)))
        _providers_cache[tmdb_id] = (now, result)
    return result


@bp.get("/<int:movie_id>/providers")
@require_auth
def movie_providers(movie_id: int):
    """Su quali piattaforme di streaming e' disponibile un film del catalogo."""
    movie = db.get_movie(movie_id)
    if movie is None:
        return jsonify({"error": "Film non trovato."}), 404
    if not config.TMDB_API_KEY:
        return jsonify({"error": "Ricerca automatica non attiva: TMDB_API_KEY non configurata.", "code": "no_key"}), 503

    try:
        match, exact = _find_match(movie["title"], movie["release_year"])
        if match is None:
            return jsonify({"found": False})
        return jsonify(
            {
                "found": True,
                "exact": exact,
                "tmdb_title": match["title"],
                "tmdb_year": match["year"],
                **_providers(match["tmdb_id"]),
            }
        )
    except LookupError_ as e:
        return jsonify({"error": str(e), "code": "lookup_failed"}), 502


BACKFILL_BATCH = 15
FUZZY_MIN_RATIO = 0.85


def _find_match(title: str, year: str = "") -> tuple[dict | None, bool]:
    """Film TMDB corrispondente a un titolo del catalogo -> (risultato, esatto).

    Il titolo salvato può essere italiano o originale: si confronta con titolo
    italiano e titolo originale, cercando prima in italiano e, se serve, anche
    in inglese. Senza corrispondenza esatta si accetta solo un titolo molto
    simile (>= FUZZY_MIN_RATIO), segnalato come "approssimato"."""
    wanted = _normalize_title(title)
    candidates = list(_search(title))

    def exact(results):
        found = [
            r for r in results if wanted in (_normalize_title(r["title"]), _normalize_title(r.get("original_title", "")))
        ]
        # Piu' film con lo stesso titolo (remake): preferisce quello dell'anno indicato.
        return next((r for r in found if year and r["year"] == year), found[0] if found else None)

    found = exact(candidates)
    if found is None:
        extra = [r for r in _search(title, "en-US") if r["tmdb_id"] not in {c["tmdb_id"] for c in candidates}]
        candidates += extra
        found = exact(candidates)
    if found is not None:
        return found, True

    best, best_ratio = None, 0.0
    for r in candidates:
        for name in (r["title"], r.get("original_title", "")):
            ratio = difflib.SequenceMatcher(None, wanted, _normalize_title(name)).ratio()
            if ratio > best_ratio:
                best, best_ratio = r, ratio
    return (best, False) if best is not None and best_ratio >= FUZZY_MIN_RATIO else (None, False)


@bp.post("/backfill-collections")
@require_auth
def backfill_collections():
    """Rileva saga, anno di uscita e durata dei film già presenti nel catalogo.

    Elabora un lotto (BACKFILL_BATCH film) per chiamata, a partire da
    `after_id`, e risponde con `next_after_id` (null = finito): il frontend
    ripete la chiamata finché ce n'e'. Prudente: usa un risultato di TMDB solo
    se il suo titolo coincide con quello del film (ignorando maiuscole e
    punteggiatura); gli altri vengono saltati, per non assegnare saghe sbagliate.
    """
    if not config.TMDB_API_KEY:
        return jsonify({"error": "Ricerca automatica non attiva: TMDB_API_KEY non configurata.", "code": "no_key"}), 503

    payload = request.get_json(silent=True) or {}
    after_id = int(payload.get("after_id") or 0)

    batch = db.movies_without_collection_info(after_id, BACKFILL_BATCH)
    matched = with_collection = with_runtime = 0
    skipped: list[str] = []
    approximate: list[str] = []

    try:
        for movie in batch:
            match, is_exact = _find_match(movie["title"])
            if match is None:
                skipped.append(movie["title"])
                continue
            details = _details(match["tmdb_id"])
            # Mai sovrascrivere ciò che è già stato impostato a mano.
            update = {}
            # Corrispondenza solo approssimata: si usa la sola durata, senza
            # toccare anno e saga (un errore lì raggrupperebbe film sbagliati).
            if is_exact and not movie["release_year"] and match["year"]:
                update["release_year"] = match["year"]
            if is_exact and details["collection"] and not movie["collection"]:
                update["collection"] = details["collection"]
                with_collection += 1
            if not is_exact and details["runtime"] and not movie["runtime"]:
                approximate.append(f'{movie["title"]} → {match["title"]} ({match["year"]})')
            if details["runtime"] and not movie["runtime"]:
                update["runtime"] = details["runtime"]
                with_runtime += 1
            if update:
                db.update_movie(movie["id"], update)
            matched += 1
    except LookupError_ as e:
        return jsonify({"error": str(e), "code": "lookup_failed"}), 502

    if with_collection or with_runtime:
        activity.publish(
            g.current_user,
            "update",
            "movies",
            f"Dati TMDB completati: {with_collection} saghe, {with_runtime} durate",
        )

    next_after_id = batch[-1]["id"] if len(batch) == BACKFILL_BATCH else None
    return jsonify(
        {
            "processed": len(batch),
            "matched": matched,
            "with_collection": with_collection,
            "with_runtime": with_runtime,
            "skipped": skipped,
            "approximate": approximate,
            "next_after_id": next_after_id,
        }
    )
