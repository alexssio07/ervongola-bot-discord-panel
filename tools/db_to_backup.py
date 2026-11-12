#!/usr/bin/env python3
"""
Converte i film del vecchio pannello (SQLite, panel.db) in un file di backup JSON, nello
stesso formato che il pannello scarica da "Film > Backup" e che accetta in "Ripristina da file".

Cosi' puoi portare i film che hai gia' nel nuovo pannello su Vercel senza toccare Blob a mano:

  python tools/db_to_backup.py --db percorso/di/panel.db
  (crea film-backup.json)  poi nel pannello: Film > Backup > Ripristina da file

Il database viene aperto in sola lettura: l'originale non viene modificato.
Non servono librerie extra (solo la libreria standard di Python).
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

FIELDS = (
    "title", "link", "platform", "status", "cover_url", "genre", "notes", "watched_at",
    "added_by", "proposed_by", "collection", "release_year", "runtime", "created_at", "updated_at",
)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, required=True, help="percorso di panel.db")
    p.add_argument("--out", type=Path, default=Path("film-backup.json"), help="file da creare (default: film-backup.json)")
    args = p.parse_args()

    if not args.db.is_file():
        sys.exit(f"Database non trovato: {args.db}")
    con = sqlite3.connect(f"file:{args.db.resolve().as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        columns = {r["name"] for r in con.execute("PRAGMA table_info(movies)")}
        if not columns:
            sys.exit("Questo database non ha la tabella 'movies': e' il file giusto (panel.db)?")
        rows = [dict(r) for r in con.execute("SELECT * FROM movies ORDER BY id")]
    finally:
        con.close()

    movies = []
    for row in rows:
        movie = {"id": row["id"]}
        for field in FIELDS:
            value = row.get(field)  # colonne assenti nei database piu' vecchi: restano vuote
            if value is not None:
                movie[field] = value
        movies.append(movie)

    backup = {
        "format": "ervongola-movies-backup",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "count": len(movies),
        "movies": movies,
    }
    args.out.write_text(json.dumps(backup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    missing = [f for f in FIELDS if f not in columns]
    print(f"{len(movies)} film salvati in {args.out}")
    if missing:
        print(f"(il database e' di una versione piu' vecchia: campi assenti e lasciati vuoti: {', '.join(missing)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
