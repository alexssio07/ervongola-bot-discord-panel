"""
Archivio del pannello: documenti JSON e file binari (gli mp3).

Un'unica interfaccia, due backend:

  LocalStore  cartella su disco (api/data/store). Predefinito in sviluppo.
  BlobStore   Vercel Blob. Predefinito su Vercel (STORAGE_BACKEND=blob).

Il resto del codice (db.py, phrases_store.py, activity.py, voice.py...) usa solo
le funzioni di questo modulo e non sa dove finiscono i dati.

Cose da sapere su Vercel Blob (verificate sulla documentazione, vedi guida):
  - il piano Hobby include 10.000 operazioni semplici (letture/head) e 2.000
    avanzate (put/list) al mese; superate, Blob si blocca per 30 giorni. Per
    questo le letture passano da una cache in memoria e list/put sono rari;
  - l'SDK Python non ha scritture condizionali ne' lettura "senza cache": per le
    modifiche (leggi-modifica-scrivi) si legge il blob con un URL che contiene
    l'etag, cosi' la CDN non puo' restituire una versione vecchia;
  - dopo una scrittura la CDN puo' servire il vecchio contenuto fino a ~60 s:
    l'istanza che ha scritto tiene quindi il nuovo valore in memoria per 70 s.
Fra istanze diverse (raro con pochi utenti) i dati possono quindi essere visti con
un ritardo massimo di circa un minuto; le modifiche concorrenti sullo stesso file
sono "l'ultima scrittura vince" (come gia' era per i file JSON del bot).
"""

import copy
import json
import logging
import threading
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

import config

logger = logging.getLogger("panel.storage")

CHUNK_SIZE = 64 * 1024
# La CDN di Blob tiene i contenuti almeno 60 s: dopo una scrittura l'istanza che
# ha scritto serve il proprio valore per un po' di piu' di questo intervallo.
BLOB_CDN_SECONDS = 60
WRITE_THROUGH_SECONDS = 70


class SkipWrite(Exception):
    """Da sollevare dentro la funzione di update_json per non scrivere nulla
    (es. elemento non trovato) e restituire `result` al chiamante."""

    def __init__(self, result=None):
        super().__init__()
        self.result = result


class LocalStore:
    kind = "local"

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, name: str) -> Path:
        root = self.root.resolve()
        path = (root / name).resolve()
        if path != root and root not in path.parents:
            raise ValueError(f"Nome non valido: {name}")
        return path

    def read(self, name, fresh=False, max_age=None):
        try:
            return self._path(name).read_bytes()
        except FileNotFoundError:
            return None

    def write(self, name, data, content_type="application/octet-stream"):
        path = self._path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)  # scrittura atomica

    def delete(self, name):
        self._path(name).unlink(missing_ok=True)

    def list_files(self, prefix="", max_age=0):
        base = self._path(prefix.rstrip("/")) if prefix else self.root
        if not base.is_dir():
            return []
        found = []
        for path in sorted(base.rglob("*")):
            if path.is_file() and not path.name.endswith(".tmp"):
                found.append({"name": path.relative_to(self.root).as_posix(), "size": path.stat().st_size})
        return found

    def open_stream(self, name):
        path = self._path(name)
        if not path.is_file():
            return None

        def chunks():
            with open(path, "rb") as handle:
                while chunk := handle.read(CHUNK_SIZE):
                    yield chunk

        return {"size": path.stat().st_size}, chunks()


class _BlobStream:
    """Iteratore sui byte di un blob; close() chiude la connessione anche se
    l'iterazione non e' mai iniziata (Flask lo chiama a fine risposta)."""

    def __init__(self, context, download):
        self._context = context
        self._download = download
        self._iterator = iter(download)
        self._closed = False

    def __iter__(self):
        return self

    def __next__(self):
        try:
            return next(self._iterator)
        except BaseException:
            self.close()
            raise

    def close(self):
        if not self._closed:
            self._closed = True
            self._context.__exit__(None, None, None)


class BlobStore:
    kind = "blob"

    def __init__(self):
        # Import tardivo: il pacchetto serve solo quando si usa davvero Blob.
        from vercel import blob as blob_api
        from vercel.blob import sync as blob_sync

        self._errors = blob_api
        self._blob = blob_sync
        self._access = config.BLOB_ACCESS
        self._cache = {}  # nome -> (salvato_alle, valido_fino_a, byte)
        self._list_cache = {}  # prefisso -> (salvato_alle, elementi)
        self._lock = threading.Lock()

    # --- lettura ---
    def read(self, name, fresh=False, max_age=None):
        ttl = config.STORAGE_CACHE_TTL if max_age is None else max_age
        now = time.monotonic()
        if not fresh:
            with self._lock:
                hit = self._cache.get(name)
            if hit and (now < hit[1] or now - hit[0] < ttl):
                return hit[2]
        try:
            if fresh:
                # head restituisce l'etag aggiornato; l'etag nell'URL rende
                # impossibile ricevere dalla CDN una versione precedente.
                meta = self._blob.head_blob(name)
                url = f"{meta.url}?v={quote(meta.etag, safe='')}"
                data = self._blob.get_blob(url, access=self._access).body
            else:
                data = self._blob.get_blob(name, access=self._access).body
        except self._errors.BlobNotFoundError:
            return None
        with self._lock:
            self._cache[name] = (now, now, data)
        return data

    # --- scrittura ---
    def write(self, name, data, content_type="application/octet-stream"):
        self._blob.put_blob(
            name,
            data,
            access=self._access,
            content_type=content_type,
            allow_overwrite=True,
            add_random_suffix=False,
            cache_control_max_age=BLOB_CDN_SECONDS,
        )
        now = time.monotonic()
        with self._lock:
            self._cache[name] = (now, now + WRITE_THROUGH_SECONDS, data)
            self._list_cache.clear()

    def delete(self, name):
        self._blob.delete_blob(name)
        with self._lock:
            self._cache.pop(name, None)
            self._list_cache.clear()

    # --- elenco (operazione "avanzata": va tenuta in cache) ---
    def list_files(self, prefix="", max_age=None):
        ttl = config.AUDIO_LIST_CACHE_TTL if max_age is None else max_age
        now = time.monotonic()
        with self._lock:
            hit = self._list_cache.get(prefix)
        if hit and now - hit[0] < ttl:
            return copy.deepcopy(hit[1])
        items = [{"name": b.pathname, "size": b.size} for b in self._blob.query_blobs(prefix=prefix or None)]
        with self._lock:
            self._list_cache[prefix] = (now, items)
        return copy.deepcopy(items)

    # --- flusso di byte (anteprima audio, sincronizzazione) ---
    def open_stream(self, name):
        try:
            context = self._blob.stream_blob(name, access=self._access)
            download = context.__enter__()  # e' qui che parte la richiesta
        except self._errors.BlobNotFoundError:
            return None
        meta = {"size": download.metadata.size, "content_type": download.metadata.content_type}
        return meta, _BlobStream(context, download)


_store = None
_store_lock = threading.Lock()


def store():
    """Backend in uso, creato al primo utilizzo."""
    global _store
    with _store_lock:
        if _store is None:
            if config.STORAGE_BACKEND == "blob":
                _store = BlobStore()
            elif config.STORAGE_BACKEND == "local":
                _store = LocalStore(config.LOCAL_STORE_DIR)
            else:
                raise RuntimeError(f"STORAGE_BACKEND non valido: {config.STORAGE_BACKEND!r} (usa 'local' o 'blob').")
            logger.info("Archivio dati: %s", _store.kind)
        return _store


def reset_store() -> None:
    """Solo per i test: dimentica il backend creato."""
    global _store
    with _store_lock:
        _store = None


# --- JSON ---
def _default_value(default):
    return default() if callable(default) else copy.deepcopy(default)


def read_json(name, default=None, *, fresh=False, max_age=None):
    """Documento JSON, oppure `default` (valore o funzione) se non esiste.
    Solleva ValueError se il file esiste ma non e' JSON valido."""
    raw = store().read(name, fresh=fresh, max_age=max_age)
    if raw is None:
        return _default_value(default)
    return json.loads(raw.decode("utf-8"))


def write_json(name, data, indent=None):
    raw = json.dumps(data, ensure_ascii=False, indent=indent).encode("utf-8")
    store().write(name, raw, "application/json")


_doc_locks = defaultdict(threading.Lock)
_doc_locks_guard = threading.Lock()


def _lock_for(name):
    with _doc_locks_guard:
        return _doc_locks[name]


def update_json(name, default, mutate, indent=None):
    """Leggi-modifica-scrivi di un documento, con dato fresco e lock per
    documento (nello stesso processo). `mutate(doc)` modifica il documento sul
    posto e puo' restituire un risultato; se solleva un'eccezione non si scrive
    nulla (SkipWrite: esce senza scrivere restituendo exc.result)."""
    with _lock_for(name):
        doc = read_json(name, default, fresh=True)
        try:
            result = mutate(doc)
        except SkipWrite as skip:
            return skip.result
        write_json(name, doc, indent=indent)
        return result


# --- file binari ---
def read_bytes(name, fresh=False):
    return store().read(name, fresh=fresh)


def write_bytes(name, data, content_type="application/octet-stream"):
    store().write(name, data, content_type)


def delete(name):
    store().delete(name)


def list_files(prefix="", max_age=None):
    return store().list_files(prefix, max_age=max_age)


def open_stream(name):
    """(meta, iteratore di byte) oppure None se il file non esiste."""
    return store().open_stream(name)
