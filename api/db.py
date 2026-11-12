"""
Persistenza di film e utenti come documenti JSON (vedi storage.py): niente piu'
SQLite, che su Vercel non puo' funzionare (filesystem effimero e di sola lettura).

Le funzioni pubbliche hanno gli stessi nomi, argomenti e risultati della versione
SQLite, quindi movies.py, movie_lookup.py, forum_sync.py e auth.py non cambiano.

Documenti:
  data/movies.json  {"next_id": N, "movies": [ {id, title, link, ...}, ... ]}
  data/users.json   {"next_id": N, "users":  [ {id, username, password_hash, created_at} ]}

Le query SQL (filtri, ordinamenti, statistiche) sono ora scritte in Python sulla
lista dei film: a qualche migliaio di righe e' istantaneo. Complessita': tutte le
letture sono O(n) (filtro) o O(n log n) (ordinamento) sul catalogo; le scritture
riscrivono l'intero documento.
"""

import re
import unicodedata
from datetime import date, datetime, timezone

import config
import storage

VALID_STATUSES = ("visto", "da_guardare")

MOVIES_DOC = "data/movies.json"
USERS_DOC = "data/users.json"

# Campi di un film e relativo valore predefinito (stesse colonne della vecchia tabella).
_MOVIE_DEFAULTS = {
    "title": "",
    "link": "",
    "platform": "",
    "status": "da_guardare",
    "cover_url": "",
    "genre": "",
    "notes": "",
    "watched_at": "",
    "added_by": "",
    "proposed_by": "",
    "collection": "",
    "release_year": "",
    "runtime": 0,
    "created_at": "",
    "updated_at": "",
}


def _empty_movies() -> dict:
    return {"next_id": 1, "movies": []}


def _empty_users() -> dict:
    return {"next_id": 1, "users": []}


def _sort_key(text: str) -> str:
    """Chiave di ordinamento senza maiuscole e accenti: "Épsilon" va fra D ed F, non in fondo."""
    decomposed = unicodedata.normalize("NFKD", (text or "").casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def init_db() -> None:
    """Compatibilita' con la versione SQLite. Non scrive nulla: i documenti
    vengono creati alla prima scrittura (all'avvio su Vercel non si tocca lo store)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_row(row: dict) -> dict:
    out = {"id": row["id"]}
    for key, default in _MOVIE_DEFAULTS.items():
        value = row.get(key, default)
        out[key] = default if value is None else value
    return out


def _load_movies() -> list[dict]:
    doc = storage.read_json(MOVIES_DOC, _empty_movies)
    return [_normalize_row(m) for m in doc.get("movies", [])]


# --- filtri ---
def _genre_filters(genre: str | None) -> list[str]:
    return [g.strip().casefold() for g in (genre or "").split(",") if g.strip()]


def _matches(movie: dict, status, platform, genre_filters: list[str], search: str | None) -> bool:
    if status and movie["status"] != status:
        return False
    if platform and movie["platform"].casefold() != platform.casefold():
        return False
    if genre_filters:
        # `genre` puo' contenere piu' generi separati da virgola ("Azione,Fantascienza"):
        # il film deve averli tutti, ciascuno come genere intero.
        haystack = "," + movie["genre"].replace(", ", ",").casefold() + ","
        if any(f",{single}," not in haystack for single in genre_filters):
            return False
    if search:
        needle = search.casefold()
        if needle not in movie["title"].casefold() and needle not in movie["notes"].casefold():
            return False
    return True


def _filtered(movies, status, platform, genre, search) -> list[dict]:
    genre_filters = _genre_filters(genre)
    return [m for m in movies if _matches(m, status, platform, genre_filters, search)]


def count_movies(status: str | None, platform: str | None, genre: str | None, search: str | None) -> int:
    return len(_filtered(_load_movies(), status, platform, genre, search))


# Ordinamenti disponibili. "recenti" e' il predefinito con le saghe contigue (vedi list_movies).
SORT_OPTIONS = ("recenti", "incompleti", "titolo", "genere")


def _completeness(movie: dict) -> int:
    """Quanti campi facoltativi che descrivono davvero il film sono compilati
    (saga e data di visione non contano: per molti film restano legittimamente vuoti)."""
    return sum(
        (
            bool(movie["link"]),
            bool(movie["platform"]),
            bool(movie["cover_url"]),
            bool(movie["genre"]),
            bool(movie["notes"]),
            bool(movie["release_year"]),
            movie["runtime"] > 0,
            bool(movie["proposed_by"]),
        )
    )


def list_movies(
    status: str | None,
    platform: str | None,
    genre: str | None,
    search: str | None,
    page: int = 1,
    page_size: int = 12,
    sort: str | None = None,
) -> list[dict]:
    """Film più recenti per primi, ma i film della stessa saga (campo
    "collection") restano contigui: il gruppo prende la posizione del suo
    film inserito più di recente e, dentro il gruppo, l'ordine è per anno di
    uscita. Ogni riga porta anche quanti film ha la saga nel catalogo
    (collection_size) e quanti ne risultano visti (collection_seen).
    Con `sort` diverso da "recenti" l'ordine e' quello scelto e le saghe non
    sono tenute insieme. Complessita': O(n log n) tempo, O(n) spazio."""
    all_movies = _load_movies()
    selected = _filtered(all_movies, status, platform, genre, search)

    # Dimensione della saga, film visti e inserimento piu' recente: calcolati
    # sull'intero catalogo (non solo sui film filtrati), come faceva la query SQL.
    size: dict[str, int] = {}
    seen: dict[str, int] = {}
    latest: dict[str, str] = {}
    for movie in all_movies:
        key = movie["collection"].casefold()
        if not key:
            continue
        size[key] = size.get(key, 0) + 1
        if movie["status"] == "visto":
            seen[key] = seen.get(key, 0) + 1
        if movie["created_at"] > latest.get(key, ""):
            latest[key] = movie["created_at"]

    if sort == "incompleti":
        selected.sort(key=lambda m: (_completeness(m), _sort_key(m["title"]), m["id"]))
    elif sort == "titolo":
        selected.sort(key=lambda m: (_sort_key(m["title"]), m["id"]))
    elif sort == "genere":
        # I film senza genere in fondo; genere con piu' valori ordinato dal primo.
        selected.sort(
            key=lambda m: (1 if not m["genre"] else 0, _sort_key(m["genre"]), _sort_key(m["title"]), m["id"])
        )
    else:
        # Due passate stabili: prima i criteri secondari crescenti, poi il gruppo
        # (data piu' recente della saga, o created_at se il film non ha saga) decrescente.
        selected.sort(key=lambda m: (m["collection"].casefold(), m["release_year"], m["created_at"]))
        selected.sort(
            key=lambda m: latest[m["collection"].casefold()] if m["collection"] else m["created_at"],
            reverse=True,
        )

    offset = max(page - 1, 0) * page_size
    rows = []
    for movie in selected[offset : offset + page_size]:
        key = movie["collection"].casefold()
        rows.append({**movie, "collection_size": size.get(key, 0), "collection_seen": seen.get(key, 0)})
    return rows


def get_movie(movie_id: int) -> dict | None:
    for movie in _load_movies():
        if movie["id"] == movie_id:
            return movie
    return None


def _validate_watched_at(value) -> str:
    """Data di visione: stringa vuota oppure una data ISO valida (YYYY-MM-DD)."""
    value = (value or "").strip()
    if not value:
        return ""
    try:
        date.fromisoformat(value)
    except ValueError as e:
        raise ValueError("Data di visione non valida (formato atteso: AAAA-MM-GG).") from e
    return value


def _validate_year(value) -> str:
    """Anno di uscita: vuoto oppure 4 cifre."""
    value = str(value or "").strip()
    if value and not (len(value) == 4 and value.isdigit()):
        raise ValueError("Anno di uscita non valido (4 cifre, es. 2014).")
    return value


def _validate_runtime(value) -> int:
    """Durata in minuti: vuota/0 = sconosciuta, altrimenti 1-1000."""
    if value in (None, ""):
        return 0
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise ValueError("Durata non valida (minuti, es. 125).") from None
    if minutes < 0 or minutes > 1000:
        raise ValueError("Durata non valida (da 0 a 1000 minuti).")
    return minutes


def get_filter_options() -> dict:
    """Valori distinti di genere, piattaforma e proponente presenti nel
    catalogo, per le select dei filtri e i suggerimenti del form. I generi sono spezzati sulla virgola (un film può averne
    più di uno); i duplicati che differiscono solo per maiuscole si fondono."""

    def distinct(values) -> list[str]:
        seen: dict[str, str] = {}
        for value in values:
            value = value.strip()
            if value:
                seen.setdefault(value.casefold(), value)
        return sorted(seen.values(), key=str.casefold)

    movies = _load_movies()
    genres = distinct(g for m in movies for g in m["genre"].split(","))
    platforms = distinct(m["platform"] for m in movies)
    proposers = distinct(m["proposed_by"] for m in movies)
    collections = distinct(m["collection"] for m in movies)
    return {"genres": genres, "platforms": platforms, "proposers": proposers, "collections": collections}


def create_movie(data: dict, added_by: str = "") -> dict:
    """added_by è l'utente del pannello che inserisce il film: arriva sempre
    dal token di sessione, mai dal corpo della richiesta (non falsificabile)."""
    now = _now()
    watched_at = _validate_watched_at(data.get("watched_at"))
    release_year = _validate_year(data.get("release_year"))
    runtime = _validate_runtime(data.get("runtime"))
    status = data.get("status") or "da_guardare"
    if status not in VALID_STATUSES:
        raise ValueError(f"Stato non valido: {status}")

    def _insert(doc: dict) -> dict:
        new_id = doc["next_id"]
        doc["next_id"] = new_id + 1  # gli id non vengono mai riutilizzati (come AUTOINCREMENT)
        row = _normalize_row(
            {
                "id": new_id,
                "title": data["title"].strip(),
                "link": data.get("link", "").strip(),
                "platform": data.get("platform", "").strip(),
                "status": status,
                "cover_url": data.get("cover_url", "").strip(),
                "genre": data.get("genre", "").strip(),
                "notes": data.get("notes", "").strip(),
                "watched_at": watched_at,
                "added_by": added_by.strip(),
                "proposed_by": (data.get("proposed_by") or "").strip(),
                "collection": (data.get("collection") or "").strip(),
                "release_year": release_year,
                "runtime": runtime,
                "created_at": now,
                "updated_at": now,
            }
        )
        doc["movies"].append(row)
        return row

    return storage.update_json(MOVIES_DOC, _empty_movies, _insert)


_UPDATABLE_FIELDS = (
    "title",
    "link",
    "platform",
    "status",
    "cover_url",
    "genre",
    "notes",
    "watched_at",
    "proposed_by",
    "collection",
    "release_year",
    "runtime",
)


def update_movie(movie_id: int, data: dict) -> dict | None:
    def _update(doc: dict) -> dict:
        for index, raw in enumerate(doc["movies"]):
            if raw["id"] != movie_id:
                continue
            existing = _normalize_row(raw)

            if "status" in data and data["status"] not in VALID_STATUSES:
                raise ValueError(f"Stato non valido: {data['status']}")

            updates = {f: data[f] for f in _UPDATABLE_FIELDS if f in data}
            if "watched_at" in updates:
                updates["watched_at"] = _validate_watched_at(updates["watched_at"])
            if "release_year" in updates:
                updates["release_year"] = _validate_year(updates["release_year"])
            if "runtime" in updates:
                updates["runtime"] = _validate_runtime(updates["runtime"])
            if "collection" in updates:
                updates["collection"] = (updates["collection"] or "").strip()
            if not updates:
                raise storage.SkipWrite(existing)  # niente da cambiare: nessuna scrittura

            merged = {**existing, **updates, "updated_at": _now()}
            doc["movies"][index] = merged
            return merged
        raise storage.SkipWrite(None)  # film inesistente

    return storage.update_json(MOVIES_DOC, _empty_movies, _update)


def delete_movie(movie_id: int) -> bool:
    def _delete(doc: dict) -> bool:
        before = len(doc["movies"])
        doc["movies"] = [m for m in doc["movies"] if m["id"] != movie_id]
        if len(doc["movies"]) == before:
            raise storage.SkipWrite(False)
        return True

    return storage.update_json(MOVIES_DOC, _empty_movies, _delete)


# --- backup e ripristino da file ---
BACKUP_FORMAT = "ervongola-movies-backup"
MAX_IMPORT_ITEMS = 5000  # il corpo di una richiesta su Vercel e' comunque limitato a 4,5 MB
_REPORT_LIMIT = 20  # quanti titoli/errori elencare nel risultato


def export_backup() -> dict:
    """Tutto il catalogo in un documento autosufficiente, da salvare come file."""
    movies = sorted(_load_movies(), key=lambda m: m["id"])
    return {
        "format": BACKUP_FORMAT,
        "version": 1,
        "exported_at": _now(),
        "count": len(movies),
        "movies": movies,
    }


def _clean_text(value) -> str:
    return "" if value is None else str(value).strip()


def _backup_row(item, fallback_user: str, now: str) -> dict:
    """Un film del file -> campi validati (stesse regole di create_movie).
    Solleva ValueError con un motivo leggibile se non e' importabile."""
    if not isinstance(item, dict):
        raise ValueError("elemento non valido (non e' un film).")
    title = _clean_text(item.get("title"))
    if not title:
        raise ValueError("titolo mancante.")
    status = _clean_text(item.get("status")) or "da_guardare"
    if status not in VALID_STATUSES:
        raise ValueError(f"stato non valido: {status}")
    created_at = _clean_text(item.get("created_at")) or now
    return {
        "title": title,
        "link": _clean_text(item.get("link")),
        "platform": _clean_text(item.get("platform")),
        "status": status,
        "cover_url": _clean_text(item.get("cover_url")),
        "genre": _clean_text(item.get("genre")),
        "notes": _clean_text(item.get("notes")),
        "watched_at": _validate_watched_at(_clean_text(item.get("watched_at"))),
        "added_by": _clean_text(item.get("added_by")) or fallback_user,
        "proposed_by": _clean_text(item.get("proposed_by")),
        "collection": _clean_text(item.get("collection")),
        "release_year": _validate_year(item.get("release_year")),
        "runtime": _validate_runtime(item.get("runtime")),
        "created_at": created_at,
        "updated_at": _clean_text(item.get("updated_at")) or created_at,
    }


def import_movies(items, mode: str = "merge", importer: str = "") -> dict:
    """Importa i film di un backup.

    mode="merge":   aggiunge i film mancanti con nuovi id; quelli gia' presenti
                    (stesso titolo e anno compatibile, come in find_duplicates) sono saltati.
    mode="replace": sostituisce l'intero catalogo con il contenuto del file, mantenendo
                    gli id del file quando validi; prima salva una copia di sicurezza del
                    catalogo attuale (data/backups/movies-<data>.json).

    Un file senza nessun film valido viene rifiutato in entrambi i modi (non svuota nulla).
    Complessita': O(n + m) con un indice dei titoli normalizzati."""
    if mode not in ("merge", "replace"):
        raise ValueError("Modalita' non valida (merge o replace).")
    if not isinstance(items, list):
        raise ValueError("Il file non contiene una lista di film.")
    if len(items) > MAX_IMPORT_ITEMS:
        raise ValueError(f"Troppi film nel file (massimo {MAX_IMPORT_ITEMS}).")

    now = _now()
    accepted: list[tuple[int | None, dict]] = []
    invalid: list[dict] = []
    for index, item in enumerate(items, start=1):
        try:
            row = _backup_row(item, importer, now)
        except ValueError as e:
            title = _clean_text(item.get("title")) if isinstance(item, dict) else ""
            invalid.append({"index": index, "title": title, "error": str(e)})
            continue
        raw_id = item.get("id")
        accepted.append((raw_id if isinstance(raw_id, int) and not isinstance(raw_id, bool) and raw_id > 0 else None, row))
    if not accepted:
        raise ValueError("Nessun film valido nel file: il catalogo non e' stato modificato.")

    def _apply(doc: dict) -> dict:
        safety_copy = ""
        if mode == "replace":
            safety_copy = f"data/backups/movies-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
            storage.write_json(safety_copy, doc)  # se fallisce, il catalogo non viene toccato
            existing: list[dict] = []
        else:
            existing = list(doc["movies"])

        seen: dict[str, list[str]] = {}
        if mode == "merge":
            for movie in existing:
                seen.setdefault(_normalize_title(movie["title"]), []).append(str(movie.get("release_year") or ""))

        kept: list[tuple[int | None, dict]] = []
        skipped: list[str] = []
        used_ids: set[int] = set()
        for raw_id, row in accepted:
            if mode == "merge":
                key = _normalize_title(row["title"])
                years = seen.get(key)
                if years is not None and any(not row["release_year"] or not y or y == row["release_year"] for y in years):
                    skipped.append(row["title"])
                    continue
                seen.setdefault(key, []).append(row["release_year"])
                raw_id = None  # nuovi id: quelli del file potrebbero essere gia' presi
            elif raw_id in used_ids:
                raw_id = None  # id ripetuto nel file: ne assegna uno nuovo
            if raw_id is not None:
                used_ids.add(raw_id)
            kept.append((raw_id, row))

        if mode == "merge" and not kept:
            raise storage.SkipWrite(
                {"mode": mode, "added": 0, "skipped_duplicates": len(skipped), "skipped_titles": skipped[:_REPORT_LIMIT],
                 "invalid_count": len(invalid), "invalid": invalid[:_REPORT_LIMIT], "total": len(existing), "safety_copy": ""}
            )

        counter = max([doc["next_id"], *(i + 1 for i in used_ids)])  # gli id non vengono mai riutilizzati
        for raw_id, row in kept:
            movie_id = raw_id if raw_id is not None else counter
            if raw_id is None:
                counter += 1
            existing.append(_normalize_row({"id": movie_id, **row}))
        doc["movies"] = existing
        doc["next_id"] = counter
        return {
            "mode": mode,
            "added": len(kept),
            "skipped_duplicates": len(skipped),
            "skipped_titles": skipped[:_REPORT_LIMIT],
            "invalid_count": len(invalid),
            "invalid": invalid[:_REPORT_LIMIT],
            "total": len(existing),
            "safety_copy": safety_copy,
        }

    return storage.update_json(MOVIES_DOC, _empty_movies, _apply)


# --- utenti ---
def get_user_by_username(username: str) -> dict | None:
    # Letto con una cache piu' lunga: serve a ogni richiesta autenticata di un
    # utente registrato (vedi auth.py), e un utente nuovo e' visibile entro USERS_CACHE_TTL.
    doc = storage.read_json(USERS_DOC, _empty_users, max_age=config.USERS_CACHE_TTL)
    wanted = (username or "").casefold()
    for user in doc.get("users", []):
        if user["username"].casefold() == wanted:
            return dict(user)
    return None


def create_user(username: str, password_hash: str) -> dict:
    """Solleva ValueError se lo username è già in uso. Il controllo avviene
    dentro la stessa scrittura protetta da lock (nessuna finestra fra "esiste
    già?" e l'inserimento, almeno all'interno della stessa istanza)."""

    def _insert(doc: dict) -> dict:
        wanted = username.casefold()
        if any(u["username"].casefold() == wanted for u in doc["users"]):
            raise ValueError("Questo username è già in uso.")
        new_id = doc["next_id"]
        doc["next_id"] = new_id + 1
        row = {"id": new_id, "username": username, "password_hash": password_hash, "created_at": _now()}
        doc["users"].append(row)
        return dict(row)

    return storage.update_json(USERS_DOC, _empty_users, _insert)


def movies_without_collection_info(after_id: int, limit: int) -> list[dict]:
    """Film da completare con i dati TMDB: né saga né anno di uscita, oppure
    durata sconosciuta. Servono al rilevamento automatico sui film inseriti
    prima di queste funzioni."""
    rows = [
        {k: m[k] for k in ("id", "title", "collection", "release_year", "runtime")}
        for m in _load_movies()
        if ((m["collection"] == "" and m["release_year"] == "") or m["runtime"] == 0) and m["id"] > after_id
    ]
    rows.sort(key=lambda r: r["id"])
    return rows[:limit]


def _normalize_title(title: str) -> str:
    """Per confrontare titoli ignorando maiuscole, spazi e punteggiatura."""
    return re.sub(r"[\W_]+", "", (title or "").casefold())


def find_duplicates(title: str, release_year: str = "", exclude_id: int | None = None) -> list[dict]:
    """Film già presenti con lo stesso titolo. Se entrambi hanno l'anno di
    uscita, devono coincidere (due film omonimi di anni diversi non sono
    duplicati); se manca da una parte, il solo titolo basta per segnalare."""
    wanted = _normalize_title(title)
    if not wanted:
        return []
    year = (release_year or "").strip()

    fields = ("id", "title", "release_year", "status", "platform", "added_by", "proposed_by", "created_at")
    return [
        {k: m[k] for k in fields}
        for m in _load_movies()
        if m["id"] != exclude_id
        and _normalize_title(m["title"]) == wanted
        and (not year or not m["release_year"] or m["release_year"] == year)
    ]


def all_movie_titles() -> list[dict]:
    """id, titolo e stato di tutti i film (per il confronto con il forum Discord)."""
    movies = sorted(_load_movies(), key=lambda m: _sort_key(m["title"]))
    return [{"id": m["id"], "title": m["title"], "status": m["status"]} for m in movies]


def get_stats() -> dict:
    """Conteggio film visti / da guardare, totale e per genere. Un film con
    più generi conta in ciascuno di essi."""
    rows = _load_movies()

    seen = sum(1 for row in rows if row["status"] == "visto")
    by_genre: dict[str, dict] = {}
    for row in rows:
        genres = [g.strip() for g in row["genre"].split(",") if g.strip()] or ["Senza genere"]
        for genre in genres:
            entry = by_genre.setdefault(genre.casefold(), {"genre": genre, "seen": 0, "unseen": 0})
            entry["seen" if row["status"] == "visto" else "unseen"] += 1

    # Tempo di visione in minuti: i film senza durata nota non sono sommati,
    # ma contati a parte per non far credere che il totale sia completo.
    seen_rows = [row for row in rows if row["status"] == "visto"]
    unseen_rows = [row for row in rows if row["status"] != "visto"]
    runtime = {
        "seen_minutes": sum(row["runtime"] for row in seen_rows),
        "unseen_minutes": sum(row["runtime"] for row in unseen_rows),
        "seen_without_runtime": sum(1 for row in seen_rows if not row["runtime"]),
        "unseen_without_runtime": sum(1 for row in unseen_rows if not row["runtime"]),
    }

    genres_list = [{**e, "total": e["seen"] + e["unseen"]} for e in by_genre.values()]
    genres_list.sort(key=lambda e: (-e["total"], e["genre"].casefold()))
    return {"total": len(rows), "seen": seen, "unseen": len(rows) - seen, "by_genre": genres_list, **runtime}
