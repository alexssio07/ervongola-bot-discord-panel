#!/usr/bin/env python3
"""
Esporta da Vercel Blob i dati del pannello in file JSON leggibili, da salvare nel repository
(backup versionato: ogni modifica dei film o delle frasi si vede nel diff di Git).

Struttura prodotta in --out (default: backup/):
  backup/data/movies.json         film (stesso formato che usa il pannello)
  backup/data/users.json          utenti registrati, SOLO con --include-users (vedi sotto)
  backup/json/frasiaddio.json     frasi del bot
  backup/json/frasieffetto.json
  backup/json/blasfemia.json
  backup/audio/*.mp3              SOLO con --audio

Sicurezza: users.json contiene gli hash delle password. Con un repository pubblico NON
includerli. Per questo sono esclusi di default.

Audio: gli mp3 pesano; GitHub rifiuta file sopra 100 MB e consiglia repository sotto 1 GB.
Di default non sono inclusi (restano nello store e sul disco del bot).

I file vengono riscritti solo se il contenuto cambia, cosi' i commit mostrano solo le modifiche vere.

  set BLOB_READ_WRITE_TOKEN=...
  python tools/export_from_blob.py
  git add backup && git commit -m "Backup dati pannello" && git push

Ripristino: python tools/upload_to_blob.py --data-dir backup/data --json-dir backup/json --audio-dir backup/audio --force
Costo su Blob: pochissime operazioni semplici (una lettura per documento); con --audio, un'operazione
avanzata di elenco piu' una lettura per ogni file.
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
os.environ.setdefault("STORAGE_BACKEND", "blob")

import config  # noqa: E402
import db  # noqa: E402
import phrases_store  # noqa: E402
import storage  # noqa: E402


def write_if_changed(path: Path, data: bytes) -> bool:
    if path.is_file() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return True


def export_json(name: str, dest: Path, indent: int) -> str:
    raw = storage.read_bytes(name, fresh=True)
    if raw is None:
        return "assente nello store (saltato)"
    try:
        doc = json.loads(raw)
    except ValueError as e:
        sys.exit(f"{name}: contenuto non valido nello store ({e})")
    text = json.dumps(doc, ensure_ascii=False, indent=indent) + "\n"
    return "aggiornato" if write_if_changed(dest, text.encode("utf-8")) else "invariato"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, default=ROOT / "backup", help="cartella di destinazione (default: backup/)")
    p.add_argument("--include-users", action="store_true", help="esporta anche gli utenti (contiene gli hash delle password!)")
    p.add_argument("--audio", action="store_true", help="scarica anche gli mp3")
    args = p.parse_args()

    if config.STORAGE_BACKEND == "blob" and not (os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("VERCEL_OIDC_TOKEN")):
        sys.exit("Imposta BLOB_READ_WRITE_TOKEN (Vercel > Storage > il tuo store > .env.local).")
    print(f"Sorgente: {config.STORAGE_BACKEND}   Destinazione: {args.out}")

    docs = [(db.MOVIES_DOC, args.out / "data" / "movies.json", 2)]
    if args.include_users:
        docs.append((db.USERS_DOC, args.out / "data" / "users.json", 2))
    for spec in phrases_store.FILE_REGISTRY.values():
        docs.append((f"json/{spec.filename}", args.out / "json" / spec.filename, 4))
    for name, dest, indent in docs:
        print(f"  {name:28} {export_json(name, dest, indent)}")

    if args.audio:
        files = storage.list_files("audio/", max_age=0)
        total = sum(f["size"] for f in files)
        print(f"  audio: {len(files)} file, {total / 1024 / 1024:.1f} MB")
        for f in files:
            target = args.out / "audio" / Path(f["name"]).name
            if target.is_file() and target.stat().st_size == f["size"]:
                continue
            data = storage.read_bytes(f["name"], fresh=True)
            if data is None:
                print(f"    {f['name']}: sparito dallo store (saltato)")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, target)
            print(f"    scaricato {Path(f['name']).name}")
    if not args.include_users:
        print("(utenti non esportati: usa --include-users solo se il repository e' privato)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
