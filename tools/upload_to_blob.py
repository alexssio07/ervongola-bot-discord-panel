#!/usr/bin/env python3
"""
Carica nello archivio del pannello (Vercel Blob) i dati che oggi stanno sul Pi / sul PC:

  --db PATH         film e utenti dal vecchio database SQLite (api/data/panel.db)
  --json-dir DIR    frasiaddio.json, frasieffetto.json, blasfemia.json (cartella json/ del bot)
  --audio-dir DIR   i file .mp3/.wav (cartella audio_files/ del bot), di qualsiasi dimensione

Si esegue UNA volta, dal PC, prima di aprire il pannello su Vercel. E' sicuro rilanciarlo:
un documento gia' presente nello archivio NON viene sovrascritto (altrimenti si
perderebbero le modifiche fatte dal pannello) salvo --force; gli audio gia' presenti
con la stessa dimensione sono saltati.

Prima volta:
  pip install vercel-blob python-dotenv
  set BLOB_READ_WRITE_TOKEN=...        (Windows; su Linux/macOS: export ...)
  python tools/upload_to_blob.py --db api/data/panel.db --json-dir ../json --audio-dir ../audio_files --dry-run
  (se il piano va bene) lo stesso comando senza --dry-run

Con STORAGE_BACKEND=local carica invece nello archivio su disco (api/data/store), utile
per provare il pannello in locale con gli stessi dati.
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
os.environ.setdefault("STORAGE_BACKEND", "blob")

import config  # noqa: E402
import db  # noqa: E402
import phrases_store  # noqa: E402
import storage  # noqa: E402

AUDIO_EXTENSIONS = (".mp3", ".wav")
AUDIO_MIME = {".mp3": "audio/mpeg", ".wav": "audio/wav"}
HOBBY_STORAGE_BYTES = 1024**3


def exists(name: str) -> bool:
    return storage.read_bytes(name, fresh=True) is not None


def plan_db(path: Path, force: bool, actions: list):
    if not path.is_file():
        sys.exit(f"Database non trovato: {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    tables = {r["name"] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def next_id(table: str, rows: list[dict]) -> int:
        highest = max((r["id"] for r in rows), default=0)
        if "sqlite_sequence" in tables:
            seq = con.execute("SELECT seq FROM sqlite_sequence WHERE name=?", (table,)).fetchone()
            highest = max(highest, seq["seq"] if seq else 0)
        return highest + 1

    if "movies" in tables:
        movies = [db._normalize_row(dict(r)) for r in con.execute("SELECT * FROM movies ORDER BY id")]
        doc = {"next_id": next_id("movies", movies), "movies": movies}
        actions.append((db.MOVIES_DOC, f"{len(movies)} film", lambda d=doc: storage.write_json(db.MOVIES_DOC, d), force))
    if "users" in tables:
        users = [dict(r) for r in con.execute("SELECT id, username, password_hash, created_at FROM users ORDER BY id")]
        doc = {"next_id": next_id("users", users), "users": users}
        actions.append((db.USERS_DOC, f"{len(users)} utenti registrati (l'admin fisso e' nelle variabili d'ambiente)",
                        lambda d=doc: storage.write_json(db.USERS_DOC, d), force))
    con.close()


def plan_json(directory: Path, force: bool, actions: list):
    for key, spec in phrases_store.FILE_REGISTRY.items():
        path = directory / spec.filename
        if not path.is_file():
            print(f"  (salto) {path} non esiste")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            sys.exit(f"{path}: JSON non valido ({e})")
        if not isinstance(data.get(spec.list_key), list):
            sys.exit(f"{path}: manca la lista '{spec.list_key}'")
        name = f"json/{spec.filename}"
        actions.append((name, f"{len(data[spec.list_key])} elementi", lambda n=name, d=data: storage.write_json(n, d, indent=4), force))


def plan_audio(directory: Path, force: bool, actions: list):
    remote = {f["name"]: f["size"] for f in storage.list_files("audio/", max_age=0)}
    total = 0
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        size = path.stat().st_size
        total += size
        name = f"audio/{path.name}"
        if not force and remote.get(name) == size:
            print(f"  (gia' presente, stessa dimensione) {path.name}")
            continue
        mime = AUDIO_MIME[path.suffix.lower()]
        actions.append((name, f"{size / 1024 / 1024:.1f} MB", lambda n=name, p=path, m=mime: storage.write_bytes(n, p.read_bytes(), m), True))
    if config.STORAGE_BACKEND == "blob" and total > HOBBY_STORAGE_BYTES * 0.9:
        print(f"ATTENZIONE: {total / 1024**3:.2f} GB di audio, il piano Hobby include 1 GB di archiviazione.")
    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, help="percorso di panel.db (SQLite)")
    parser.add_argument("--json-dir", type=Path, help="cartella con i json delle frasi")
    parser.add_argument("--audio-dir", type=Path, help="cartella con gli audio")
    parser.add_argument("--force", action="store_true", help="sovrascrive i documenti gia' presenti nello archivio")
    parser.add_argument("--dry-run", action="store_true", help="mostra solo cosa farebbe")
    args = parser.parse_args()
    if not (args.db or args.json_dir or args.audio_dir):
        parser.error("indica almeno uno fra --db, --json-dir, --audio-dir")

    if config.STORAGE_BACKEND == "blob" and not (os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("VERCEL_OIDC_TOKEN")):
        sys.exit("Imposta BLOB_READ_WRITE_TOKEN (Vercel > Storage > il tuo Blob store > .env.local) oppure usa STORAGE_BACKEND=local.")
    print(f"Archivio di destinazione: {config.STORAGE_BACKEND}" + (f" ({config.BLOB_ACCESS})" if config.STORAGE_BACKEND == "blob" else ""))

    actions: list = []  # (nome, descrizione, funzione, sovrascrivi?)
    if args.db:
        plan_db(args.db, args.force, actions)
    if args.json_dir:
        plan_json(args.json_dir, args.force, actions)
    if args.audio_dir:
        plan_audio(args.audio_dir, args.force, actions)

    done = skipped = 0
    for name, description, run, overwrite in actions:
        if not overwrite and not args.force and exists(name):
            print(f"  SALTATO  {name} ({description}): esiste gia' nello archivio, usa --force per sovrascriverlo")
            skipped += 1
            continue
        print(f"  {'(prova)  ' if args.dry_run else 'CARICO   '}{name} - {description}")
        if not args.dry_run:
            run()
            done += 1
    puts = len(actions) - skipped
    print(f"\n{'Piano' if args.dry_run else 'Fatto'}: {puts} caricamenti (ognuno e' 1 operazione 'avanzata' su Blob, 2.000/mese gratis), {skipped} saltati.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
