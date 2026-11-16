import json
from datetime import date

from flask import Blueprint, Response, g, jsonify, request

import activity
import phrases_store as store
from auth import require_permission

bp = Blueprint("phrases", __name__, url_prefix="/api/phrases")

MAX_RESTORE_BYTES = 4 * 1024 * 1024  # sotto il limite di 4,5 MB del corpo di una richiesta su Vercel


@bp.get("/files")
@require_permission("phrases", "read")
def get_files():
    """Elenco dei file JSON gestibili, per popolare i tab del menu 'Modifica frasi'."""
    return jsonify(store.list_files())


@bp.get("/backup")
@require_permission("phrases", "read")
def download_backup():
    """Scarica tutti i file di frasi come un unico JSON (ripristinabile con POST /restore)."""
    body = json.dumps(store.export_backup(), ensure_ascii=False, indent=2)
    filename = f"ervongola-frasi-backup-{date.today().isoformat()}.json"
    return Response(
        body,
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@bp.post("/restore")
@require_permission("phrases", "write")
def restore_backup():
    """Importa un backup. Campo `file` (multipart) e `mode`: merge (predefinito, aggiunge le
    frasi mancanti e salta i doppioni) oppure replace (sostituisce le liste presenti nel
    backup, salvando prima una copia di sicurezza di ciascuna)."""
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

    mode = request.form.get("mode") or "merge"
    try:
        result = store.import_backup(document, mode)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    for key, outcome in result["files"].items():
        if outcome["added"] or mode == "replace":
            activity.publish(
                g.current_user, "update" if mode == "replace" else "add", key, f"{outcome['added']} frasi da backup"
            )
    return jsonify(result)


@bp.get("/<file_key>/similar")
@require_permission("phrases", "read")
def get_similar(file_key: str):
    """Frasi già presenti molto simili a quella che si sta scrivendo (avviso live del form)."""
    try:
        similar = store.find_similar(file_key, request.args.get("text", ""))
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"similar": similar})


@bp.get("/<file_key>")
@require_permission("phrases", "read")
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
@require_permission("phrases", "write")
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
@require_permission("phrases", "write")
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
@require_permission("phrases", "write")
def delete_phrase(file_key: str, index: int):
    expected = request.args.get("expected")

    try:
        removed = store.delete_phrase(file_key, index, expected)
    except store.PhraseFileError as e:
        return jsonify({"error": str(e)}), 400

    activity.publish(g.current_user, "delete", file_key, removed)
    return "", 204
