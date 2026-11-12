"""
Sincronizzazione verso il bot: il bot (che legge frasi e audio dal proprio disco)
scarica da qui lo stato del pannello con tools/bot_sync.py.

Autenticazione macchina-macchina con BOT_SYNC_TOKEN nell'header X-Sync-Token,
distinta dal login admin. Se BOT_SYNC_TOKEN e' vuoto gli endpoint sono disattivati.

  GET /api/sync/bundle      i tre documenti di frasi + elenco degli audio (nome, dimensione)
  GET /api/sync/audio?name= i byte di un audio, in streaming
"""

import hmac

from flask import Blueprint, Response, jsonify, request

import config
import phrases_store as store
import storage
import voice

bp = Blueprint("sync", __name__, url_prefix="/api/sync")


def _unauthorized():
    if not config.BOT_SYNC_TOKEN:
        return jsonify({"error": "Sincronizzazione disattivata (BOT_SYNC_TOKEN non impostato)."}), 503
    given = request.headers.get("X-Sync-Token", "")
    if not hmac.compare_digest(given.encode(), config.BOT_SYNC_TOKEN.encode()):
        return jsonify({"error": "Token non valido."}), 401
    return None


@bp.get("/bundle")
def bundle():
    denied = _unauthorized()
    if denied:
        return denied
    phrases = {key: store._load_raw(spec) for key, spec in store.FILE_REGISTRY.items()}
    audio = [{"name": f["name"], "size": f["size"]} for f in voice._list_audio()]
    return jsonify({"phrases": phrases, "audio": audio})


@bp.get("/audio")
def audio():
    denied = _unauthorized()
    if denied:
        return denied
    name = request.args.get("name", "")
    if name not in {f["name"] for f in voice._list_audio()}:
        return jsonify({"error": "File audio non trovato."}), 404
    opened = storage.open_stream(voice.AUDIO_PREFIX + name)
    if opened is None:
        return jsonify({"error": "File audio non trovato."}), 404
    meta, chunks = opened
    response = Response(chunks, mimetype="application/octet-stream", direct_passthrough=True)
    if meta.get("size"):
        response.headers["Content-Length"] = str(meta["size"])
    return response
