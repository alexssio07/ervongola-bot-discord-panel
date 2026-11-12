from flask import Blueprint, g, jsonify, request

import activity
import phrases_store as store
from auth import require_auth

bp = Blueprint("phrases", __name__, url_prefix="/api/phrases")


@bp.get("/files")
@require_auth
def get_files():
    """Elenco dei file JSON gestibili, per popolare i tab del menu 'Modifica frasi'."""
    return jsonify(store.list_files())


@bp.get("/<file_key>/similar")
@require_auth
def get_similar(file_key: str):
    """Frasi già presenti molto simili a quella che si sta scrivendo (avviso live del form)."""
    try:
        similar = store.find_similar(file_key, request.args.get("text", ""))
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"similar": similar})


@bp.get("/<file_key>")
@require_auth
def get_phrases(file_key: str):
    search = request.args.get("search")
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("page_size", 20)), 1), 200)

    try:
        result = store.get_page(file_key, search, page, page_size)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify(result)


@bp.post("/<file_key>")
@require_auth
def add_phrase(file_key: str):
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")

    try:
        new_index = store.add_phrase(file_key, text)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    activity.publish(g.current_user, "add", file_key, text.strip())
    return jsonify({"index": new_index}), 201


@bp.put("/<file_key>/<int:index>")
@require_auth
def update_phrase(file_key: str, index: int):
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    expected = payload.get("expected_text")

    try:
        old_text = store.update_phrase(file_key, index, text, expected)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    activity.publish(g.current_user, "update", file_key, text.strip(), old_text)
    return jsonify({"ok": True})


@bp.delete("/<file_key>/<int:index>")
@require_auth
def delete_phrase(file_key: str, index: int):
    expected = request.args.get("expected")

    try:
        removed = store.delete_phrase(file_key, index, expected)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    activity.publish(g.current_user, "delete", file_key, removed)
    return "", 204
