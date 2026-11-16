"""
Autenticazione: un admin "fisso" via variabili d'ambiente (comportamento
originale, invariato) più utenti registrabili liberamente dal pannello
stesso (vedi register_user sotto), salvati nella tabella "users" di db.py.
Niente libreria JWT esterna: usiamo ciò che Flask porta già con sé.

- werkzeug.security (dipendenza diretta di Flask) per l'hashing password.
- itsdangerous (dipendenza diretta di Flask) per firmare un token con
  scadenza — stesso principio di un JWT, senza aggiungere PyJWT al progetto.

PERMESSI: ogni utente ha un livello per area ("movies", "phrases", "audio"):
"none" < "read" < "write" (la scrittura include la lettura). L'admin fisso ha
sempre tutto. Chi si registra parte in SOLA LETTURA; gli utenti creati prima
dell'introduzione dei permessi (senza il campo "permissions") mantengono
l'accesso completo. I controlli sono fatti qui, lato server, su ogni route
(require_permission): nascondere i pulsanti nel frontend non basterebbe.
La registrazione resta aperta a chiunque raggiunga la pagina di login.
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

AREAS = ("movies", "phrases", "audio")
LEVELS = ("none", "read", "write")  # in ordine crescente
DEFAULT_NEW_USER_PERMISSIONS = {area: "read" for area in AREAS}
FULL_PERMISSIONS = {area: "write" for area in AREAS}
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

    db.create_user(username, hash_password(password), permissions=DEFAULT_NEW_USER_PERMISSIONS)


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


def is_admin(username: str) -> bool:
    return username == config.ADMIN_USERNAME


def normalize_permissions(raw: dict | None) -> dict:
    """Permessi validi per tutte le aree. Livelli o aree sconosciuti vengono
    scartati (area mancante = "none"): un dato corrotto non deve mai concedere
    piu' di quanto scritto."""
    raw = raw if isinstance(raw, dict) else {}
    return {area: raw[area] if raw.get(area) in LEVELS else "none" for area in AREAS}


def get_permissions(username: str, fresh: bool = False) -> dict:
    if is_admin(username):
        return dict(FULL_PERMISSIONS)
    user = db.get_user_by_username(username, fresh=fresh)
    if user is None:
        # Token valido ma utente non ancora visibile a questa istanza (appena
        # registrato): vale il minimo di un nuovo iscritto.
        return dict(DEFAULT_NEW_USER_PERMISSIONS)
    if "permissions" not in user:
        return dict(FULL_PERMISSIONS)  # utente precedente ai permessi
    return normalize_permissions(user["permissions"])


def has_permission(username: str, area: str, level: str = "read") -> bool:
    # Le scritture rileggono l'utente senza cache: una revoca vale subito.
    perms = get_permissions(username, fresh=(level == "write"))
    return LEVELS.index(perms.get(area, "none")) >= LEVELS.index(level)


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


def require_permission(area: str, level: str = "read"):
    """Come require_auth, in piu' richiede almeno `level` sull'area. Senza
    permesso risponde 403 (non 401: la sessione e' valida, quindi il frontend
    non deve fare il logout)."""
    if area not in AREAS or level not in ("read", "write"):
        raise ValueError(f"Permesso non valido: {area}/{level}")

    def decorator(view_func):
        @wraps(view_func)
        def checked(*args, **kwargs):
            if not has_permission(g.current_user, area, level):
                return jsonify({"error": "Non hai i permessi per questa operazione.", "code": "forbidden"}), 403
            return view_func(*args, **kwargs)

        return require_auth(checked)

    return decorator


def require_admin(view_func):
    """Solo l'admin fisso (ADMIN_USERNAME)."""

    @wraps(view_func)
    def checked(*args, **kwargs):
        if not is_admin(g.current_user):
            return jsonify({"error": "Solo l'amministratore può farlo.", "code": "forbidden"}), 403
        return view_func(*args, **kwargs)

    return require_auth(checked)
