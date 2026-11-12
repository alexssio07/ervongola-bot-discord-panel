import logging

from flask import Blueprint, jsonify, request

import config
from auth import create_token, register_user, verify_credentials

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


@bp.post("/register")
def register():
    """Registrazione senza codice d'invito, disponibile solo fuori dalla produzione
    (preview/test/locale; vedi config.ALLOW_REGISTRATION e l'avviso in auth.py). Risponde
    con lo stesso formato del login: chi si registra entra subito nel pannello."""
    if not config.ALLOW_REGISTRATION:
        return jsonify({"error": "La registrazione di nuovi utenti è disattivata in questo ambiente."}), 403

    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "")
    password = payload.get("password", "")

    try:
        register_user(username, password)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    logger.info("Nuovo utente registrato dal pannello: %r", username.strip())
    return _token_response(username.strip(), status=201)
