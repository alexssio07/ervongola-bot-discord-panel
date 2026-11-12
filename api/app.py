import logging
import os

from flask import Flask
from flask_cors import CORS

import config
import db
from activity import bp as activity_bp
from auth_routes import bp as auth_bp
from forum_sync import bp as forum_sync_bp
from frontend import bp as frontend_bp
from movie_lookup import bp as movie_lookup_bp
from movies import bp as movies_bp
from phrases import bp as phrases_bp
from sync import bp as sync_bp
from voice import bp as voice_bp

logging.basicConfig(
    level=logging.INFO,
    format="[{asctime}] [{levelname}] {message}",
    style="{",
    datefmt="%d/%m/%Y %H:%M:%S",
)
logger = logging.getLogger("panel")

app = Flask(__name__)
CORS(app, origins=config.CORS_ALLOWED_ORIGINS, supports_credentials=True)

app.register_blueprint(auth_bp)
app.register_blueprint(movies_bp)
app.register_blueprint(movie_lookup_bp)
app.register_blueprint(forum_sync_bp)
app.register_blueprint(phrases_bp)
app.register_blueprint(activity_bp)
app.register_blueprint(voice_bp)
app.register_blueprint(sync_bp)
# Ultimo apposta: espone il build del frontend con una route catch-all
# ("/", "/<path:path>"). Non ruba richieste a "/api/..." — vedi frontend.py.
# Su Vercel il frontend e' un progetto separato: qui non trova nessun build e
# risponde solo con un messaggio.
app.register_blueprint(frontend_bp)


@app.get("/api/health")
def health():
    return {"status": "ok"}


def _startup_checks() -> None:
    db.init_db()
    insecure_secret = config.SECRET_KEY.startswith("CHANGE-ME")
    if insecure_secret and config.ON_VERCEL:
        # Con la chiave di default chiunque potrebbe firmarsi un token valido e
        # entrare nel pannello: su un deploy pubblico e' meglio non partire affatto.
        raise RuntimeError("SECRET_KEY non impostata: configurala nelle Environment Variables del progetto Vercel.")
    if not config.ADMIN_PASSWORD_HASH:
        logger.warning(
            "ADMIN_PASSWORD_HASH non impostato: il login admin sarà sempre rifiutato. "
            "Genera un hash con 'python hash_password.py <password>'."
        )
    if insecure_secret:
        logger.warning("SECRET_KEY è ancora al valore di default: impostala prima di esporre il pannello.")
    if config.ON_VERCEL and config.ALLOW_REGISTRATION:
        logger.warning(
            "Registrazione aperta a chiunque in questo deploy (%s): in produzione e' sempre chiusa; "
            "ALLOW_REGISTRATION=false la chiude anche qui.",
            config.VERCEL_ENV or "ambiente non production",
        )


_startup_checks()


if __name__ == "__main__":
    # threaded=True: senza, il server di sviluppo Werkzeug e' single-thread.
    debug_mode = os.getenv("FLASK_DEBUG", "true").strip().lower() == "true"
    app.run(port=5000, debug=debug_mode, threaded=True)
