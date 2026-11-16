"""Gestione utenti e permessi: riservata all'admin fisso (ADMIN_USERNAME)."""

import logging

from flask import Blueprint, g, jsonify, request

import db
from auth import AREAS, LEVELS, normalize_permissions, require_admin

bp = Blueprint("admin_routes", __name__, url_prefix="/api/admin")
logger = logging.getLogger("panel.admin")


def _public_user(user: dict) -> dict:
    # Utenti precedenti ai permessi (campo assente) hanno accesso completo:
    # l'admin li vede cosi' e puo' ridurli.
    perms = normalize_permissions(user["permissions"]) if "permissions" in user else {a: "write" for a in AREAS}
    return {"id": user["id"], "username": user["username"], "created_at": user.get("created_at"), "permissions": perms}


@bp.get("/users")
@require_admin
def list_users():
    return jsonify({"areas": list(AREAS), "levels": list(LEVELS), "users": [_public_user(u) for u in db.list_users()]})


@bp.put("/users/<int:user_id>/permissions")
@require_admin
def update_permissions(user_id: int):
    raw = (request.get_json(silent=True) or {}).get("permissions")
    if not isinstance(raw, dict) or any(k not in AREAS or v not in LEVELS for k, v in raw.items()):
        return jsonify({"error": "Permessi non validi."}), 400

    # Aree non indicate restano "none": l'invio deve essere completo.
    if set(raw) != set(AREAS):
        return jsonify({"error": "Indica un livello per ogni area."}), 400

    user = db.set_user_permissions(user_id, raw)
    if user is None:
        return jsonify({"error": "Utente non trovato."}), 404
    logger.info("Permessi di %r aggiornati da %r: %s", user["username"], g.current_user, raw)
    return jsonify(_public_user(user))


@bp.delete("/users/<int:user_id>")
@require_admin
def delete_user(user_id: int):
    if not db.delete_user(user_id):
        return jsonify({"error": "Utente non trovato."}), 404
    logger.info("Utente id=%s eliminato da %r", user_id, g.current_user)
    return jsonify({"ok": True})
