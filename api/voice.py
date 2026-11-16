"""
Pagina "Audio" del pannello: elenco degli mp3 salvati nello archivio (cartella
audio/, vedi storage.py), ascolto in anteprima nel browser e - se configurato -
controllo del bot nel canale vocale (connetti / riproduci / ferma / disconnetti).

Elenco e anteprima funzionano sempre, anche col bot spento (l'anteprima delle frasi
e' generata dal pannello stesso con Google TTS). Le azioni vocali sono
inoltrate al server di controllo del bot (panel_control.py), che e' l'unico a
parlare con Discord: da Vercel servono BOT_CONTROL_URL (URL pubblico HTTPS di quel
server) e BOT_CONTROL_TOKEN; senza, rispondono "non disponibile" senza errori.
"""

import io
import logging
import os
import threading
from collections import OrderedDict

import requests
from flask import Blueprint, Response, jsonify, request

import config
import storage
from auth import require_permission

bp = Blueprint("voice", __name__, url_prefix="/api/voice")
logger = logging.getLogger("panel.voice")

AUDIO_PREFIX = "audio/"
AUDIO_EXTENSIONS = (".mp3", ".wav")
AUDIO_MIME = {".mp3": "audio/mpeg", ".wav": "audio/wav"}
# La connessione vocale puo' richiedere fino a ~60s (handshake) + attesa lock.
CONNECT_TIMEOUT = 95
DEFAULT_TIMEOUT = 10

NOT_CONFIGURED = "Controllo del bot non configurato: imposta BOT_CONTROL_URL (e BOT_CONTROL_TOKEN) nel backend."


def _list_audio() -> list[dict]:
    """File audio dell'archivio, ordinati per titolo. L'`id` e' la posizione in
    elenco: non coincide piu' con quello di /list_audio_commands del bot (che
    dipende dall'ordine di os.listdir sul disco del bot)."""
    files = []
    for item in storage.list_files(AUDIO_PREFIX, max_age=config.AUDIO_LIST_CACHE_TTL):
        name = item["name"][len(AUDIO_PREFIX) :]
        if name and "/" not in name and name.lower().endswith(AUDIO_EXTENSIONS):
            files.append({"name": name, "title": os.path.splitext(name)[0], "size": item["size"]})
    files.sort(key=lambda f: f["title"].lower())
    for position, file in enumerate(files, start=1):
        file["id"] = position
    return files


def _control_headers() -> dict:
    return {"X-Control-Token": config.BOT_CONTROL_TOKEN}


def _call_bot(method: str, path: str, payload: dict | None = None, timeout: int = DEFAULT_TIMEOUT):
    """Inoltra la richiesta al bot e restituisce (json, status) da girare al client."""
    if not config.BOT_CONTROL_URL:
        return {"error": NOT_CONFIGURED, "code": "not_configured"}, 503
    try:
        res = requests.request(
            method,
            f"{config.BOT_CONTROL_URL}{path}",
            json=payload,
            headers=_control_headers(),
            timeout=timeout,
        )
    except requests.ConnectionError:
        return {"error": "Il bot non risponde (spento o ancora in avvio)."}, 503
    except requests.Timeout:
        return {"error": "Il bot ha impiegato troppo a rispondere."}, 504

    try:
        data = res.json()
    except ValueError:
        data = {"error": f"Risposta non valida dal bot (HTTP {res.status_code})."}

    if res.status_code == 401:
        # 401 dal bot != sessione scaduta del pannello: va tradotto, altrimenti
        # il frontend slogga l'utente (vedi interceptor in client.ts).
        return {"error": "Token di controllo non coincidente: allinea BOT_CONTROL_TOKEN del pannello con quello del bot."}, 502
    return data, res.status_code


@bp.get("/audio")
@require_permission("audio", "read")
def list_audio():
    return jsonify({"files": _list_audio()})


@bp.get("/audio/file")
@require_permission("audio", "read")
def audio_file():
    """Anteprima: manda al browser i byte di un audio (in streaming, quindi senza
    il limite di 4,5 MB delle risposte di una funzione Vercel)."""
    name = request.args.get("name", "")
    # Solo nomi realmente presenti nell'elenco: nessun percorso arbitrario.
    if name not in {f["name"] for f in _list_audio()}:
        return jsonify({"error": "File audio non trovato."}), 404

    opened = storage.open_stream(AUDIO_PREFIX + name)
    if opened is None:
        return jsonify({"error": "File audio non trovato."}), 404
    meta, chunks = opened

    mimetype = AUDIO_MIME.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
    response = Response(chunks, mimetype=mimetype, direct_passthrough=True)
    if meta.get("size"):
        response.headers["Content-Length"] = str(meta["size"])
    response.headers["Cache-Control"] = "private, max-age=3600"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@bp.get("/status")
@require_permission("audio", "read")
def status():
    if not config.BOT_CONTROL_URL:
        # Il frontend smette di interrogare lo stato ogni pochi secondi.
        return jsonify(
            {"available": False, "configured": False, "connected": False, "playing": False, "error": NOT_CONFIGURED}
        )
    data, code = _call_bot("GET", "/status")
    if code != 200:
        # Il pannello non deve rompersi se il bot e' giu': stato "non disponibile".
        return jsonify(
            {"available": False, "configured": True, "connected": False, "playing": False, "error": data.get("error")}
        )
    return jsonify({"available": True, "configured": True, **data})


@bp.get("/channels")
@require_permission("audio", "read")
def channels():
    if not config.BOT_CONTROL_URL:
        return jsonify({"channels": []})  # nessun bot collegato: elenco vuoto, non un errore
    data, code = _call_bot("GET", "/channels")
    return jsonify(data), code


@bp.post("/connect")
@require_permission("audio", "write")
def connect():
    payload = request.get_json(silent=True) or {}
    data, code = _call_bot("POST", "/connect", {"channel_id": str(payload.get("channel_id", ""))}, CONNECT_TIMEOUT)
    return jsonify(data), code


@bp.post("/disconnect")
@require_permission("audio", "write")
def disconnect():
    data, code = _call_bot("POST", "/disconnect", {}, CONNECT_TIMEOUT)
    return jsonify(data), code


@bp.post("/play")
@require_permission("audio", "write")
def play():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("file", ""))
    # Validazione anche lato pannello: accetta solo nomi realmente presenti.
    if name not in {f["name"] for f in _list_audio()}:
        return jsonify({"error": "File audio non trovato."}), 404
    data, code = _call_bot("POST", "/play", {"file": name})
    return jsonify(data), code


@bp.post("/stop")
@require_permission("audio", "write")
def stop():
    data, code = _call_bot("POST", "/stop", {})
    return jsonify(data), code


# Anteprima delle frasi: audio generato con Google TTS (gTTS), la stessa voce del bot.
# Cache in memoria (LRU) per istanza: riascoltare la stessa frase non richiama Google.
TTS_MAX_CHARS = 500
TTS_TIMEOUT = 15
_TTS_CACHE_MAX = 64
_tts_cache: "OrderedDict[str, bytes]" = OrderedDict()
_tts_cache_lock = threading.Lock()


def _synthesize(text: str) -> bytes:
    """Genera l'mp3 con gTTS. Solleva RuntimeError con un messaggio mostrabile."""
    with _tts_cache_lock:
        cached = _tts_cache.get(text)
        if cached is not None:
            _tts_cache.move_to_end(text)
            return cached
    try:
        from gtts import gTTS, gTTSError
    except ImportError as e:  # dipendenza non installata nel deploy
        raise RuntimeError("Google TTS non disponibile: aggiungi gTTS a api/requirements.txt e rifai il deploy.") from e
    try:
        buffer = io.BytesIO()
        gTTS(text=text, lang=config.TTS_LANG, tld=config.TTS_TLD, slow=False, lang_check=False, timeout=TTS_TIMEOUT).write_to_fp(buffer)
    except gTTSError as e:
        logger.warning("gTTS fallito: %s", e)
        raise RuntimeError("Google TTS non ha risposto. Riprova tra poco.") from e
    except requests.RequestException as e:
        logger.warning("gTTS: errore di rete: %s", e)
        raise RuntimeError("Google TTS non raggiungibile. Riprova tra poco.") from e
    audio = buffer.getvalue()
    if not audio:
        raise RuntimeError("Google TTS ha restituito un audio vuoto.")
    with _tts_cache_lock:
        _tts_cache[text] = audio
        while len(_tts_cache) > _TTS_CACHE_MAX:
            _tts_cache.popitem(last=False)
    return audio


@bp.post("/tts")
@require_permission("audio", "read")  # solo anteprima: genera un mp3, non cambia lo stato del bot
def tts_preview():
    """Anteprima audio di una frase con Google TTS (stessa voce del bot, italiano)."""
    payload = request.get_json(silent=True) or {}
    text = " ".join(str(payload.get("text", "")).split())
    if not text:
        return jsonify({"error": "Testo mancante."}), 400
    if len(text) > TTS_MAX_CHARS:
        return jsonify({"error": f"Testo troppo lungo per l'anteprima (massimo {TTS_MAX_CHARS} caratteri)."}), 400
    try:
        audio = _synthesize(text)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

    out = Response(audio, mimetype="audio/mpeg")
    out.headers["Cache-Control"] = "private, max-age=3600"
    return out
