"""
Autenticazione: un admin "fisso" via variabili d'ambiente (comportamento
originale, invariato) più utenti registrabili liberamente dal pannello
stesso (vedi register_user sotto), salvati nella tabella "users" di db.py.
Niente libreria JWT esterna: usiamo ciò che Flask porta già con sé.

- werkzeug.security (dipendenza diretta di Flask) per l'hashing password.
- itsdangerous (dipendenza diretta di Flask) per firmare un token con
  scadenza — stesso principio di un JWT, senza aggiungere PyJWT al progetto.

ATTENZIONE (sicurezza): la registrazione è volutamente aperta a chiunque
raggiunga la pagina di login, senza alcun codice/invito — scelta esplicita
del proprietario del pannello. Chiunque possa raggiungere il pannello in
rete può quindi crearsi un account con accesso completo (film, frasi, log).
Va tenuto in conto se il pannello viene mai esposto oltre alla rete privata
in cui gira oggi.
"""

from datetime import datetime, timezone
from functools import wraps

from flask import g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import config
import db

_serializer = URLSafeTimedSerializer(config.SECRET_KEY, salt="ervongola-panel-auth")

MIN_PASSWORD_LENGTH = 6
# Un token appena emesso (login o registrazione) e' valido senza interrogare lo
# store: con piu' istanze serverless l'elenco utenti letto da un'altra istanza
# puo' non contenere ancora l'utente appena registrato, e lo butterebbe fuori.
FRESH_TOKEN_SECONDS = 90


def hash_password(plain_password: str) -> str:
    return generate_password_hash(plain_password)


def verify_credentials(username: str, password: str) -> bool:
    if username == config.ADMIN_USERNAME:
        if not config.ADMIN_PASSWORD_HASH:
            return False
        return check_password_hash(config.ADMIN_PASSWORD_HASH, password)

    user = db.get_user_by_username(username)
    if user is None:
        return False
    return check_password_hash(user["password_hash"], password)


def register_user(username: str, password: str) -> None:
    """Crea un nuovo utente. Solleva ValueError (messaggio in italiano,
    già pensato per essere mostrato all'utente) se qualcosa non va."""
    username = username.strip()
    if not username or not password:
        raise ValueError("Username e password sono obbligatori.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"La password deve avere almeno {MIN_PASSWORD_LENGTH} caratteri.")
    if username.lower() == config.ADMIN_USERNAME.lower():
        raise ValueError("Questo username è riservato.")

    db.create_user(username, hash_password(password))


def create_token(username: str) -> str:
    return _serializer.dumps({"username": username})


def _username_is_valid(username: str) -> bool:
    """Un token è valido solo se lo username che porta corrisponde ancora a
    un account esistente — admin fisso oppure un utente registrato. Per
    l'admin fisso il controllo è gratuito (nessuna query); per gli altri
    costa una lettura dell'elenco utenti (in cache per USERS_CACHE_TTL secondi)
    per richiesta autenticata, accettabile per un pannello a basso traffico e
    preferibile a fidarsi ciecamente della sola firma (un utente eliminato in futuro perderebbe subito l'accesso)."""
    return username == config.ADMIN_USERNAME or db.get_user_by_username(username) is not None


def verify_token(token: str) -> str | None:
    """Ritorna lo username se il token è valido e non scaduto, altrimenti None."""
    try:
        data, issued_at = _serializer.loads(token, max_age=config.TOKEN_MAX_AGE_SECONDS, return_timestamp=True)
    except (BadSignature, SignatureExpired):
        return None
    username = data.get("username")
    if not username:
        return None
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - issued_at).total_seconds() < FRESH_TOKEN_SECONDS:
        return username
    return username if _username_is_valid(username) else None


def require_auth(view_func):
    """Decorator per le route HTTP: richiede 'Authorization: Bearer <token>'.

    Il token può arrivare anche come query param ?token=... (utile dove non si
    possono impostare header custom, es. EventSource o un tag <audio>).
    """

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else request.args.get("token", "")

        username = verify_token(token) if token else None
        if username is None:
            return jsonify({"error": "Autenticazione richiesta o token scaduto."}), 401

        g.current_user = username
        return view_func(*args, **kwargs)

    return wrapper
