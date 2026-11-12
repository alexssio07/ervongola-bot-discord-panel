#!/usr/bin/env python3
"""
Prova di Vercel Blob con il TUO store, prima di fidarti del pannello.

Il pannello si appoggia a due comportamenti di Blob che l'SDK Python documenta ma che
qui non si possono verificare senza un vero store: la scrittura con sovrascrittura e la
lettura "fresca" (URL con l'etag) subito dopo una modifica. Questo script li prova e
stampa OK / FALLITO per ciascuno, poi cancella i suoi file di prova (selftest/...).

  pip install vercel-blob python-dotenv
  set BLOB_READ_WRITE_TOKEN=...
  python tools/blob_selftest.py

Costa circa 4 operazioni avanzate e una decina di semplici sul piano gratuito.
"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
os.environ["STORAGE_BACKEND"] = "blob"

import config  # noqa: E402
import storage  # noqa: E402

if not (os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("VERCEL_OIDC_TOKEN")):
    sys.exit("Imposta BLOB_READ_WRITE_TOKEN (Vercel > Storage > il tuo Blob store).")

failures = []


def check(ok: bool, label: str, detail: str = ""):
    print(("  OK       " if ok else "  FALLITO  ") + label + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(label)


name = f"selftest/probe-{int(time.time())}.json"
print(f"Store: accesso '{config.BLOB_ACCESS}' (deve coincidere con quello dello store creato su Vercel)\n")
store = storage.store()
try:
    store.write(name, json.dumps({"v": 1}).encode(), "application/json")
    check(True, "scrittura (put) con allow_overwrite e cache 60 s")
except Exception as e:  # noqa: BLE001
    check(False, "scrittura (put)", f"{type(e).__name__}: {e}")
    sys.exit("Nessun senso proseguire: controlla BLOB_ACCESS (public/private) e il token.\n")

try:
    check(json.loads(store.read(name, fresh=True)) == {"v": 1}, "lettura fresca (head + URL con etag) legge la v1")
    store.write(name, json.dumps({"v": 2}).encode(), "application/json")
    check(True, "seconda scrittura sullo stesso nome (sovrascrittura)")

    # Un'altra istanza serverless: cache vuota. La lettura "normale" passa dalla CDN e puo'
    # mostrare ancora la v1 per fino a ~60 s (informativo); quella fresca DEVE dare la v2.
    other = storage.BlobStore()
    normal = json.loads(other.read(name))
    print(f"  info     lettura normale subito dopo la modifica (CDN): v{normal['v']}  (v1 = ritardo previsto, <= 60 s)")
    check(json.loads(other.read(name, fresh=True)) == {"v": 2}, "lettura fresca subito dopo la modifica legge la v2 (nessuna versione vecchia)")

    listed = [f["name"] for f in store.list_files("selftest/", max_age=0)]
    check(name in listed, "elenco (list) con prefisso")

    meta_stream = store.open_stream(name)
    check(meta_stream is not None and b"".join(meta_stream[1]) == b'{"v": 2}', "lettura in streaming (usata per gli mp3)")
finally:
    try:
        store.delete(name)
        check(store.read(name, fresh=True) is None, "cancellazione e documento assente -> None")
    except Exception as e:  # noqa: BLE001
        check(False, "cancellazione", f"{type(e).__name__}: {e}")

print("\n" + ("Tutto a posto: puoi procedere." if not failures else f"{len(failures)} controllo/i falliti: non pubblicare il pannello finche' non sono risolti."))
sys.exit(1 if failures else 0)
