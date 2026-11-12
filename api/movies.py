"""Blueprint CRUD per il catalogo film, con filtri per tag/piattaforma/genere/ricerca."""

import json
from datetime import date

from flask import Blueprint, Response, g, jsonify, request

import activity
import db
from auth import require_auth

bp = Blueprint("movies", __name__, url_prefix="/api/movies")

REQUIRED_FIELDS = ("title",)
MAX_RESTORE_BYTES = 4 * 1024 * 1024  # sotto il limite di 4,5 MB del corpo di una richiesta su Vercel


@bp.get("")
@require_auth
def list_movies():
    status = request.args.get("status") or None
    platform = request.args.get("platform") or None
    genre = request.args.get("genre") or None
    search = request.args.get("search") or None
    page = max(int(request.args.get("page", 1)), 1)
    # Stesso tetto massimo già usato per le frasi (200), per non permettere
    # a un client di chiedere l'intero catalogo in una volta sola.
    page_size = min(max(int(request.args.get("page_size", 12)), 1), 200)

    total = db.count_movies(status, platform, genre, search)
    sort = request.args.get("sort")
    if sort not in db.SORT_OPTIONS:
        sort = None  # valore sconosciuto: ordine predefinito (e nessun testo del client finisce nella query)
    movies = db.list_movies(status, platform, genre, search, page=page, page_size=page_size, sort=sort)

    return jsonify({"items": movies, "total": total, "page": page, "page_size": page_size})


@bp.get("/filters")
@require_auth
def get_filters():
    """Generi e piattaforme presenti nel catalogo, per le select dei filtri."""
    return jsonify(db.get_filter_options())


@bp.get("/stats")
@require_auth
def get_stats():
    """Totali visti / da guardare, anche per genere (sull'intero catalogo)."""
    return jsonify(db.get_stats())


@bp.get("/duplicates")
@require_auth
def check_duplicates():
    """Film già presenti con lo stesso titolo (e anno compatibile): usato dal
    form per avvisare PRIMA di salvare."""
    exclude = request.args.get("exclude_id", type=int)
    found = db.find_duplicates(
        request.args.get("title", ""), request.args.get("release_year", ""), exclude_id=exclude
    )
    return jsonify({"duplicates": found})


@bp.get("/backup")
@require_auth
def download_backup():
    """Scarica l'intero catalogo come file JSON (ripristinabile con POST /restore)."""
    body = json.dumps(db.export_backup(), ensure_ascii=False, indent=2)
    filename = f"ervongola-film-backup-{date.today().isoformat()}.json"
    return Response(
        body,
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@bp.post("/restore")
@require_auth
def restore_backup():
    """Importa un file di backup. Campo `file` (multipart) e `mode`: merge (predefinito,
    aggiunge i film mancanti e salta i doppioni) oppure replace (sostituisce il catalogo,
    salvando prima una copia di sicurezza)."""
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "Nessun file ricevuto."}), 400
    raw = upload.read(MAX_RESTORE_BYTES + 1)
    if len(raw) > MAX_RESTORE_BYTES:
        return jsonify({"error": "File troppo grande (massimo 4 MB)."}), 413
    try:
        document = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        return jsonify({"error": "Il file non e' un JSON valido."}), 400

    # Accetta sia il backup del pannello ({"movies": [...]}) sia una lista nuda di film.
    items = document.get("movies") if isinstance(document, dict) else document
    mode = request.form.get("mode") or "merge"
    try:
        result = db.import_movies(items, mode, importer=g.current_user)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if result["added"] or mode == "replace":
        action = "update" if mode == "replace" else "add"
        activity.publish(g.current_user, action, "movies", f"{result['added']} film da backup")
    return jsonify(result)


@bp.get("/<int:movie_id>")
@require_auth
def get_movie(movie_id: int):
    movie = db.get_movie(movie_id)
    if movie is None:
        return jsonify({"error": "Film non trovato."}), 404
    return jsonify(movie)


@bp.post("")
@require_auth
def create_movie():
    payload = request.get_json(silent=True) or {}
    missing = [f for f in REQUIRED_FIELDS if not payload.get(f, "").strip()]
    if missing:
        return jsonify({"error": f"Campi obbligatori mancanti: {', '.join(missing)}"}), 400

    # Stesso film già presente: avviso (409) a meno che il client non confermi
    # con "force". Controllo anche lato server: il solo avviso nel form non
    # protegge da due persone che inseriscono lo stesso film insieme.
    if not payload.get("force"):
        duplicates = db.find_duplicates(payload.get("title", ""), payload.get("release_year", ""))
        if duplicates:
            return (
                jsonify(
                    {
                        "error": "Questo film sembra già presente nel catalogo.",
                        "code": "duplicate",
                        "duplicates": duplicates,
                    }
                ),
                409,
            )

    try:
        movie = db.create_movie(payload, added_by=g.current_user)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    activity.publish(g.current_user, "add", "movies", movie["title"])
    return jsonify(movie), 201


@bp.put("/<int:movie_id>")
@require_auth
def update_movie(movie_id: int):
    payload = request.get_json(silent=True) or {}
    try:
        movie = db.update_movie(movie_id, payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if movie is None:
        return jsonify({"error": "Film non trovato."}), 404
    activity.publish(g.current_user, "update", "movies", movie["title"])
    return jsonify(movie)


@bp.delete("/<int:movie_id>")
@require_auth
def delete_movie(movie_id: int):
    existing = db.get_movie(movie_id)
    deleted = db.delete_movie(movie_id)
    if not deleted:
        return jsonify({"error": "Film non trovato."}), 404
    activity.publish(g.current_user, "delete", "movies", existing["title"] if existing else "")
    return "", 204
