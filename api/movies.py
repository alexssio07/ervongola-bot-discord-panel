"""Blueprint CRUD per il catalogo film, con filtri per tag/piattaforma/genere/ricerca."""

from flask import Blueprint, g, jsonify, request

import activity
import db
from auth import require_auth

bp = Blueprint("movies", __name__, url_prefix="/api/movies")

REQUIRED_FIELDS = ("title",)


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
