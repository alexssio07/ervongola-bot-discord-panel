"""
Feed delle attivita' del pannello (chi ha fatto cosa e dove).

Su Vercel non esiste memoria condivisa fra le richieste e le connessioni SSE a
lunga durata non sono praticabili: gli eventi sono quindi salvati in un
documento (storage.py, data/activity.json, ultimi BUFFER_SIZE) e il browser li
legge con GET /api/activity?since=<id> quando apre la pagina, quando torna sulla
scheda e dopo ogni propria modifica. Niente polling a tempo: ogni lettura di un
blob e' un'operazione contata dal piano gratuito di Vercel Blob.
"""

import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

import storage
from auth import require_auth

BUFFER_SIZE = 300
MAX_TEXT = 300
DOC = "data/activity.json"
# Identificatore costante: gli id degli eventi sono ora persistenti e crescenti
# (prima si azzeravano a ogni riavvio e serviva la coppia (boot, id) per deduplicare).
BOOT = "persistent"

bp = Blueprint("activity", __name__, url_prefix="/api/activity")
logger = logging.getLogger("panel.activity")


def _empty() -> dict:
    return {"counter": 0, "events": []}


def publish(user: str, action: str, scope: str, text: str = "", old_text: str = "") -> None:
    """action: add | update | delete. scope: chiave file frasi oppure 'movies'.

    Un errore qui non deve mai far fallire l'operazione principale (il film o la
    frase sono gia' stati salvati): viene solo registrato nei log."""

    def _append(doc: dict) -> None:
        doc["counter"] += 1
        doc["events"].append(
            {
                "boot": BOOT,
                "id": doc["counter"],
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "user": user,
                "action": action,
                "scope": scope,
                "text": (text or "")[:MAX_TEXT],
                "old_text": (old_text or "")[:MAX_TEXT],
                "replay": False,
            }
        )
        del doc["events"][:-BUFFER_SIZE]

    try:
        storage.update_json(DOC, _empty, _append)
    except Exception:
        logger.exception("Impossibile registrare l'attivita' (%s %s)", action, scope)


@bp.get("")
@require_auth
def list_activity():
    """Eventi con id maggiore di `since` (0 = tutto lo storico disponibile)."""
    since = request.args.get("since", default=0, type=int)
    doc = storage.read_json(DOC, _empty)
    events = [e for e in doc["events"] if e["id"] > since]
    return jsonify({"boot": BOOT, "latest": doc["counter"], "events": events})
