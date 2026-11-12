"""
Configurazione centrale del backend Flask, letta da variabili d'ambiente
(api/.env in locale, "Environment Variables" del progetto su Vercel).

Il backend gira in due modi con lo stesso codice:
  - in locale / su un server tuo: archivio su disco (STORAGE_BACKEND=local);
  - su Vercel: archivio su Vercel Blob (STORAGE_BACKEND=blob, scelto da solo
    quando Vercel imposta la variabile VERCEL).
Vedi storage.py e la guida VERCEL_DEPLOY.md alla root di web_server/.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ON_VERCEL = bool(os.getenv("VERCEL"))
_API_DIR = Path(__file__).resolve().parent


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# --- Archivio dei dati (film, utenti, frasi, audio) ---
# NB: niente mkdir all'import: su Vercel il filesystem e' di sola lettura.
# La cartella locale viene creata solo quando si scrive (vedi LocalStore).
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "").strip().lower() or ("blob" if ON_VERCEL else "local")
LOCAL_STORE_DIR = Path(os.getenv("LOCAL_STORE_DIR", str(_API_DIR / "data" / "store")))
# Deve coincidere con la modalita' dello store creato su Vercel ("private" consigliato:
# contiene gli hash delle password degli utenti).
BLOB_ACCESS = os.getenv("BLOB_ACCESS", "private").strip().lower()

# Cache in memoria (secondi). Sul piano Hobby di Vercel Blob le operazioni sono
# contate (10.000 semplici e 2.000 avanzate al mese): la cache evita di rileggere
# il blob a ogni richiesta. Le scritture leggono sempre il dato fresco.
STORAGE_CACHE_TTL = float(os.getenv("STORAGE_CACHE_TTL", "15"))
USERS_CACHE_TTL = float(os.getenv("USERS_CACHE_TTL", "60"))
AUDIO_LIST_CACHE_TTL = float(os.getenv("AUDIO_LIST_CACHE_TTL", "3600"))

# Build di produzione del frontend, servito da frontend.py solo se il backend
# gira insieme al frontend (non su Vercel, dove sono due progetti separati).
FRONTEND_DIST_DIR = Path(os.getenv("FRONTEND_DIST_DIR", str(_API_DIR.parent / "dist")))

# --- Autenticazione ---
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "")
# Ambiente Vercel: "production", "preview" o "development" (vuoto fuori da Vercel).
VERCEL_ENV = os.getenv("VERCEL_ENV", "").strip().lower()
IS_PRODUCTION = VERCEL_ENV == "production"

# Registrazione di nuovi utenti dal form di login: in PRODUZIONE su Vercel e' sempre
# chiusa (solo login, con l'admin delle variabili d'ambiente), qualunque sia
# ALLOW_REGISTRATION; in preview, in sviluppo e in locale resta aperta per le prove
# (ALLOW_REGISTRATION=false la chiude anche li').
ALLOW_REGISTRATION = (not IS_PRODUCTION) and _flag("ALLOW_REGISTRATION", True)

# --- Token di sessione (itsdangerous, incluso in Flask) ---
SECRET_KEY = os.getenv("SECRET_KEY", "CHANGE-ME-please-set-a-real-secret-in-.env")
TOKEN_MAX_AGE_SECONDS = int(os.getenv("TOKEN_MAX_AGE_MINUTES", "720")) * 60  # 12 ore di default

# --- CORS ---
# Su Vercel il frontend e' un altro progetto/dominio: metti qui il suo URL
# (separati da virgola). In sviluppo il proxy di Vite rende CORS superfluo.
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()
]
# Facoltativo: espressione regolare per gli indirizzi che cambiano a ogni deploy (le preview
# di Vercel). Deve corrispondere all'INTERO indirizzo (viene ancorata in fondo), quindi limitala
# al tuo team, ad es.  https://ervongola-dashboard-[a-z0-9-]+-alexssio07s-projects\.vercel\.app
CORS_ALLOWED_ORIGIN_REGEX = os.getenv("CORS_ALLOWED_ORIGIN_REGEX", "").strip()

# --- Ricerca automatica del genere film (TMDB, https://www.themoviedb.org) ---
# Accetta sia la "API Key (v3)" sia il "Read Access Token (v4)" (inizia con "eyJ").
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()
TMDB_WATCH_REGION = os.getenv("TMDB_WATCH_REGION", "IT").strip().upper() or "IT"

# --- Sincronizzazione dei film dal forum Discord ---
# Su Vercel va impostato esplicitamente: il pannello non gira piu' nel container del bot.
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "").strip()
MOVIES_FORUM_CHANNEL_ID = os.getenv("MOVIES_FORUM_CHANNEL_ID", "1309263537390223440").strip()

# --- Controllo vocale del bot (pagina "Audio") ---
# Il bot espone un piccolo server HTTP di controllo (panel_control.py). Da Vercel
# la localhost del bot non e' raggiungibile: senza BOT_CONTROL_URL (un URL
# pubblico HTTPS verso quel server) i controlli vocali risultano "non disponibili",
# mentre elenco e ascolto degli audio funzionano comunque.
BOT_CONTROL_URL = os.getenv("BOT_CONTROL_URL", "" if ON_VERCEL else "http://127.0.0.1:8081").strip().rstrip("/")
BOT_CONTROL_TOKEN = os.getenv("BOT_CONTROL_TOKEN", "").strip()

# --- Sincronizzazione verso il bot (frasi e audio) ---
# Segreto macchina-macchina usato da tools/bot_sync.py (eseguito dove gira il bot).
# Vuoto = endpoint /api/sync disattivati.
BOT_SYNC_TOKEN = os.getenv("BOT_SYNC_TOKEN", "").strip()
