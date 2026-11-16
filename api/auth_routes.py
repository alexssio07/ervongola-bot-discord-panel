import logging

from flask import Blueprint, g, jsonify, request

import config
from auth import create_token, get_permissions, is_admin, register_user, require_auth, verify_credentials

bp = Blueprint("auth_routes", __name__, url_prefix="/api/auth")
logger = logging.getLogger("panel.auth")


def _token_response(username: str, status: int = 200):
    token = create_token(username)
    return (
        jsonify(
            {
                "access_token": token,
                "token_type": "bearer",
                "expires_in_minutes": config.TOKEN_MAX_AGE_SECONDS // 60,
            }
        ),
        status,
    )


@bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    password = payload.get("password", "")

    if not verify_credentials(username, password):
        # Messaggio generico apposta: non riveliamo se a sbagliare è stato
        # lo username o la password (evita user enumeration).
        logger.warning("Tentativo di login fallito per username=%r", username)
        return jsonify({"error": "Credenziali non valide."}), 401

    return _token_response(username)


@bp.get("/config")
def public_config():
    """Cosa puo' mostrare la pagina di login (nessun dato sensibile)."""
    return jsonify({"registration_enabled": config.ALLOW_REGISTRATION})


@bp.get("/me")
@require_auth
def me():
    """Chi sono e cosa posso fare (il frontend lo usa per mostrare/nascondere le azioni;
    il vero controllo resta sulle singole route)."""
    return jsonify(
        {
            "username": g.current_user,
            "is_admin": is_admin(g.current_user),
            "permissions": get_permissions(g.current_user, fresh=True),
        }
    )


@bp.post("/register")
def register():
    """Registrazione senza codice d'invito. Chi si registra entra subito nel pannello, ma in
    sola lettura finche' l'admin non gli assegna altri permessi (vedi auth.py). Risponde con
    lo stesso formato del login. ALLOW_REGISTRATION=false la chiude."""
    if not config.ALLOW_REGISTRATION:
        return jsonify({"error": "La registrazione di nuovi utenti è temporaneamente disattivata."}), 403

    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    password = payload.get("password", "")

    try:
        register_user(username, password)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    logger.info("Nuovo utente registrato dal pannello: %r", username.strip())
    return _token_response(username.strip(), status=201)
