"""
Lettura/scrittura in-place dei file JSON di frasi usati dal bot
(frasiaddio.json, frasieffetto.json, blasfemia.json). Ora vivono nello
archivio del pannello (storage.py: Vercel Blob oppure disco) sotto json/, con lo
stesso identico formato che il bot si aspetta; tools/bot_sync.py li porta al bot.

Sostituisce la logica del vecchio api/app.py, che aveva alcuni bug reali:
  - `jsonify({data})` in get_file: {data} è un set-literal su un dict, che
    solleva TypeError ("unhashable type: dict") ad ogni chiamata — la GET
    non ha mai funzionato.
  - `if not isinstance(items["frasi"], list) or "frasi" not in items["frasi"]`
    in save_file: la seconda condizione controlla se la stringa "frasi" è
    un ELEMENTO della lista items["frasi"] (non ha senso — controllava
    l'array su se stesso invece che il payload contenitore), quindi la
    validazione non validava nulla di utile.
  - gestiva solo "blasfemia" e "frasieffetto": "frasiaddio" non era previsto.
  - endpoint (/api/getFile/<f>, /api/saveFile/<f>) diversi da quelli che il
    frontend (ConfigEditorList.tsx) chiamava davvero (/api/<f>): la UI non
    poteva funzionare contro questo backend.

Ogni file ha un formato leggermente diverso:
  - frasiaddio.json:   {"frasi": ["stringa", "stringa", ...]}  (solo il testo)
  - frasieffetto.json: {"frasi": [{"text": "...", "users": [...]}, ...]}
  - blasfemia.json:    {"bestemmie": [{"text": "..."}, ...]}

FILE_REGISTRY astrae queste differenze così backend e frontend trattano i
tre file allo stesso identico modo (index, text).
"""

import difflib
import re
import threading
import unicodedata
from dataclasses import dataclass, field

import storage


@dataclass(frozen=True)
class FileSpec:
    filename: str
    list_key: str
    # Se True, ogni elemento della lista è un oggetto {"text": ..., ...};
    # se False, è una stringa semplice (caso di frasiaddio.json).
    is_object: bool
    label: str
    # Campi extra da aggiungere quando si crea un NUOVO elemento oggetto,
    # per rispettare lo schema che il bot si aspetta in quel file
    # (frasieffetto.json tiene traccia di "users" per ogni frase,
    # blasfemia.json invece no).
    new_item_extra: dict = field(default_factory=dict)


FILE_REGISTRY: dict[str, FileSpec] = {
    "frasiaddio": FileSpec("frasiaddio.json", "frasi", is_object=False, label="Frasi d'addio"),
    "frasieffetto": FileSpec(
        "frasieffetto.json",
        "frasi",
        is_object=True,
        label="Frasi d'effetto (ingresso canale)",
        new_item_extra={"users": []},
    ),
    "blasfemia": FileSpec("blasfemia.json", "bestemmie", is_object=True, label="Blasfemie"),
}

# Un lock per file: evita che due richieste concorrenti nella stessa istanza si
# pestino i piedi durante un read-modify-write. Fra istanze diverse (Vercel) e
# verso il bot resta "ultimo che scrive vince", accettabile per un pannello a
# basso volume di modifiche.
_locks: dict[str, threading.Lock] = {key: threading.Lock() for key in FILE_REGISTRY}


class PhraseFileError(Exception):
    pass


def _spec(file_key: str) -> FileSpec:
    spec = FILE_REGISTRY.get(file_key)
    if spec is None:
        raise PhraseFileError(f"File sconosciuto: {file_key}")
    return spec


def _doc_name(spec: FileSpec) -> str:
    return f"json/{spec.filename}"


def _load_raw(spec: FileSpec, fresh: bool = False) -> dict:
    """`fresh=True` salta la cache in memoria: obbligatorio prima di modificare e
    riscrivere il file, altrimenti si rischia di perdere una modifica altrui."""
    try:
        data = storage.read_json(_doc_name(spec), None, fresh=fresh)
    except ValueError as e:
        raise PhraseFileError(f"JSON non valido in {spec.filename}: {e}") from e
    if data is None:
        return {spec.list_key: []}
    data.setdefault(spec.list_key, [])
    if not spec.is_object:
        # File di sole stringhe (frasiaddio): tollera il vecchio formato a
        # oggetti {"text": ..., "count": ...} riducendolo al solo testo.
        data[spec.list_key] = [
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in data[spec.list_key]
        ]
    return data


def _save_raw(spec: FileSpec, data: dict) -> None:
    """Scrittura atomica (file temporaneo + rename in locale, put su Blob)."""
    storage.write_json(_doc_name(spec), data, indent=4)


def _extract_text(spec: FileSpec, item) -> str:
    if spec.is_object:
        return str(item.get("text", ""))
    return str(item)


def list_files() -> list[dict]:
    return [{"key": key, "label": spec.label} for key, spec in FILE_REGISTRY.items()]


def get_page(file_key: str, search: str | None, page: int, page_size: int) -> dict:
    spec = _spec(file_key)
    data = _load_raw(spec)
    items = data[spec.list_key]

    indexed = [{"index": i, "text": _extract_text(spec, item)} for i, item in enumerate(items)]

    if search and search.strip():
        # "cerca ogni parola": ogni parola della query deve comparire nel
        # testo (AND fra i termini), case-insensitive.
        words = [w.lower() for w in search.strip().split() if w]
        indexed = [row for row in indexed if all(w in row["text"].lower() for w in words)]

    total = len(indexed)
    start = max(page - 1, 0) * page_size
    page_items = indexed[start : start + page_size]

    return {
        "file_key": file_key,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": page_items,
    }


def add_phrase(file_key: str, text: str) -> int:
    spec = _spec(file_key)
    text = text.strip()
    if not text:
        raise PhraseFileError("Il testo della frase non può essere vuoto.")

    with _locks[file_key]:
        data = _load_raw(spec, fresh=True)
        items = data[spec.list_key]

        if any(_extract_text(spec, item).lower() == text.lower() for item in items):
            raise PhraseFileError("Questa frase esiste già.")

        new_item = {"text": text, **spec.new_item_extra} if spec.is_object else text
        items.append(new_item)
        _save_raw(spec, data)
        return len(items) - 1


def _check_expected(spec: FileSpec, item, expected: str | None) -> None:
    """Se il client indica il testo che credeva di modificare/eliminare, lo
    confronta con quello reale: con piu' persone al lavoro gli indici possono
    essere cambiati (es. qualcuno ha eliminato una riga sopra)."""
    if expected is not None and _extract_text(spec, item) != expected:
        raise PhraseFileError(
            "La frase e' stata modificata o spostata da qualcun altro: aggiorna la lista e riprova."
        )


SIMILAR_MIN_SCORE = 0.7
SIMILAR_MIN_LENGTH = 4
SIMILAR_MAX_RESULTS = 5


def _normalize(text: str) -> str:
    """Minuscolo, senza accenti né punteggiatura, spazi compattati: "Ciao,  MONDO!" == "ciao mondo"."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[\W_]+", " ", stripped).strip()


def find_similar(file_key: str, text: str, exclude_index: int | None = None) -> list[dict]:
    """Frasi già presenti molto simili a `text`, dalla più simile (max 5).

    Punteggio 0-1 = il migliore fra somiglianza dei caratteri (difflib) e
    sovrapposizione delle parole (Jaccard); una frase che ne contiene
    un'altra per intero (almeno 3 parole) vale almeno 0.85. Soglia 0.7.
    Costo: O(n * L^2) nel caso peggiore, ma i filtri rapidi di difflib
    scartano subito quasi tutte le frasi."""
    spec = _spec(file_key)
    wanted = _normalize(text)
    if len(wanted) < SIMILAR_MIN_LENGTH:
        return []
    wanted_words = set(wanted.split())

    matcher = difflib.SequenceMatcher(None, autojunk=False)
    matcher.set_seq2(wanted)  # seq2 viene analizzata una sola volta per tutte le confronti

    found = []
    for index, item in enumerate(_load_raw(spec)[spec.list_key]):
        if index == exclude_index:
            continue
        original = _extract_text(spec, item)
        candidate = _normalize(original)
        if not candidate:
            continue

        if candidate == wanted:
            score = 1.0
        else:
            matcher.set_seq1(candidate)
            score = 0.0
            if matcher.real_quick_ratio() >= SIMILAR_MIN_SCORE and matcher.quick_ratio() >= SIMILAR_MIN_SCORE:
                score = matcher.ratio()
            words = set(candidate.split())
            union = wanted_words | words
            score = max(score, len(wanted_words & words) / len(union) if union else 0.0)
            shorter, longer = sorted((candidate, wanted), key=len)
            if len(shorter.split()) >= 3 and shorter in longer:
                score = max(score, 0.85)

        if score >= SIMILAR_MIN_SCORE:
            found.append({"index": index, "text": original, "score": round(score, 2), "exact": score == 1.0})

    found.sort(key=lambda row: -row["score"])
    return found[:SIMILAR_MAX_RESULTS]


def update_phrase(file_key: str, index: int, text: str, expected: str | None = None) -> str:
    """Ritorna il testo precedente."""
    spec = _spec(file_key)
    text = text.strip()
    if not text:
        raise PhraseFileError("Il testo della frase non può essere vuoto.")

    with _locks[file_key]:
        data = _load_raw(spec, fresh=True)
        items = data[spec.list_key]

        if index < 0 or index >= len(items):
            raise PhraseFileError("Indice frase non valido (la lista potrebbe essere cambiata).")

        _check_expected(spec, items[index], expected)
        old_text = _extract_text(spec, items[index])

        if spec.is_object:
            items[index]["text"] = text
        else:
            items[index] = text

        _save_raw(spec, data)
        return old_text


def delete_phrase(file_key: str, index: int, expected: str | None = None) -> str:
    """Ritorna il testo eliminato."""
    spec = _spec(file_key)

    with _locks[file_key]:
        data = _load_raw(spec, fresh=True)
        items = data[spec.list_key]

        if index < 0 or index >= len(items):
            raise PhraseFileError("Indice frase non valido (la lista potrebbe essere cambiata).")

        _check_expected(spec, items[index], expected)
        removed = items.pop(index)
        _save_raw(spec, data)
        return _extract_text(spec, removed)
