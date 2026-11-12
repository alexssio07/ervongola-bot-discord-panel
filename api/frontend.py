"""
Serve il build di produzione del frontend React (web_server/dist/, generato
con "npm run build") dallo stesso processo Flask che espone le API — usato
quando bot e pannello girano nello stesso container Docker (vedi il
Dockerfile alla root della repo ed entrypoint.sh), così frontend e backend
condividono la stessa origine e non serve configurare CORS in produzione.

In sviluppo locale (npm run dev) questo blueprint resta silenzioso: la
cartella dist/ non esiste finché non si lancia "npm run build", ed è comunque
Vite a servire il frontend sulla porta 5173 con proxy verso questo backend.

La route catch-all "/<path:path>" qui sotto NON entra in conflitto con le
route delle API (/api/...): Werkzeug ordina le regole di routing per
specificità, quindi una route letterale come "/api/movies" vince sempre su
un converter generico come "<path:path>", indipendentemente dall'ordine di
registrazione dei blueprint. Verificato con un test end-to-end (vedi note di
consegna) e non solo per assunzione.
"""

from flask import Blueprint, send_from_directory

from config import FRONTEND_DIST_DIR

bp = Blueprint("frontend", __name__)

_INDEX_HTML = "index.html"


@bp.get("/", defaults={"path": ""})
@bp.get("/<path:path>")
def serve_frontend(path: str):
    """Serve un asset statico se esiste, altrimenti index.html.

    Il fallback su index.html è necessario per il routing lato client di
    react-router: un refresh su /movies o /logs deve restituire comunque la
    SPA (che poi mostra la pagina giusta), non un 404.
    """
    # Una richiesta a /api/qualcosa che non corrisponde a nessuna route reale
    # deve restituire un 404 vero (utile per il debug lato client), non
    # l'HTML della SPA: senza questo controllo, un errore di battitura o un
    # endpoint rimosso sparirebbero silenziosamente dietro una pagina HTML
    # invece di un errore visibile.
    if path == "api" or path.startswith("api/"):
        return {"error": "Endpoint non trovato."}, 404

    if not FRONTEND_DIST_DIR.exists():
        return (
            "Build del frontend non trovato. Esegui 'npm run build' in "
            "web_server/, oppure usa 'npm run dev' in sviluppo (Vite serve "
            "il frontend sulla porta 5173).",
            404,
        )

    requested = FRONTEND_DIST_DIR / path if path else None
    if requested is not None and requested.is_file():
        return send_from_directory(FRONTEND_DIST_DIR, path)

    return send_from_directory(FRONTEND_DIST_DIR, _INDEX_HTML)
