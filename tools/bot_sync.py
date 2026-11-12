#!/usr/bin/env python3
"""
Allinea il bot (sul Pi) con quello che hai modificato dal pannello su Vercel.

Il bot continua a leggere frasi e audio dal proprio disco: questo script, a intervalli,
scarica da /api/sync/bundle i tre json e scarica i nuovi/cambiati mp3 da /api/sync/audio.
Solo libreria standard, nessuna dipendenza da installare nel container del bot.

Regola di unione (importante): il bot scrive i contatori "users" dentro
frasieffetto.json (frasiconteggio.py). Il pannello non li conosce, quindi per ogni
frase con lo stesso "text" i campi locali diversi da "text" (es. "users") vengono
MANTENUTI; le frasi nuove arrivano senza contatori; quelle cancellate dal pannello
spariscono. Le liste di stringhe (frasiaddio) sono sostituite per intero.
Gli audio rimossi dal pannello NON vengono cancellati dal disco del bot.

Variabili d'ambiente:
  PANEL_SYNC_URL    es. https://il-tuo-backend.vercel.app
  PANEL_SYNC_TOKEN  lo stesso valore di BOT_SYNC_TOKEN impostato sul backend

Uso:
  python tools/bot_sync.py --once --json-dir json --audio-dir audio_files
  python tools/bot_sync.py --interval 3600 ...     (resta in esecuzione)

Ogni giro costa poche operazioni su Blob: l'intervallo di default (1 h) e' scelto per
restare nel piano gratuito; i dati nuovi arrivano al bot con quel ritardo.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LIST_KEYS = {"frasiaddio": "frasi", "frasieffetto": "frasi", "blasfemia": "bestemmie"}
TIMEOUT = 60


def merge_doc(remote: dict, local: dict | None, list_key: str) -> dict:
    """Documento remoto + campi locali per-elemento (vedi docstring del modulo)."""
    merged = dict(remote)
    items = remote.get(list_key, [])
    if not local or not isinstance(local.get(list_key), list):
        return merged
    by_text = {}
    for item in local[list_key]:
        if isinstance(item, dict) and "text" in item:
            by_text.setdefault(item["text"], item)
    out = []
    for item in items:
        if isinstance(item, dict) and item.get("text") in by_text:
            kept = {k: v for k, v in by_text[item["text"]].items() if k != "text"}
            out.append({**item, **kept})  # i campi locali (es. "users") vincono
        else:
            out.append(item)
    merged[list_key] = out
    return merged


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def request(url: str, token: str):
    req = urllib.request.Request(url, headers={"X-Sync-Token": token, "User-Agent": "er-vongola-bot-sync"})
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def sync_once(base: str, token: str, json_dir: Path, audio_dir: Path) -> None:
    with request(f"{base}/api/sync/bundle", token) as r:
        bundle = json.load(r)

    for key, doc in bundle["phrases"].items():
        list_key = LIST_KEYS.get(key)
        if list_key is None:
            continue
        path = json_dir / f"{key}.json"
        local = None
        if path.is_file():
            try:
                local = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                local = None
        merged = merge_doc(doc, local, list_key)
        text = json.dumps(merged, ensure_ascii=False, indent=4)
        if not path.is_file() or path.read_text(encoding="utf-8") != text:
            atomic_write(path, text.encode("utf-8"))
            print(f"[sync] aggiornato {path.name}")

    for item in bundle["audio"]:
        name = Path(item["name"]).name  # niente percorsi: solo il nome del file
        target = audio_dir / name
        if target.is_file() and target.stat().st_size == item["size"]:
            continue
        with request(f"{base}/api/sync/audio?name={urllib.parse.quote(item['name'])}", token) as r:
            atomic_write(target, r.read())
        print(f"[sync] scaricato {name} ({item['size']} byte)")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json-dir", type=Path, default=Path("json"))
    p.add_argument("--audio-dir", type=Path, default=Path("audio_files"))
    p.add_argument("--interval", type=int, default=3600, help="secondi fra un giro e l'altro (default 3600)")
    p.add_argument("--once", action="store_true", help="un solo giro e poi esce")
    args = p.parse_args()

    base = os.getenv("PANEL_SYNC_URL", "").rstrip("/")
    token = os.getenv("PANEL_SYNC_TOKEN", "")
    if not base or not token:
        sys.exit("Imposta PANEL_SYNC_URL e PANEL_SYNC_TOKEN.")

    while True:
        try:
            sync_once(base, token, args.json_dir, args.audio_dir)
        except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
            print(f"[sync] errore: {e}", file=sys.stderr)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(max(60, args.interval))


if __name__ == "__main__":
    sys.exit(main())
