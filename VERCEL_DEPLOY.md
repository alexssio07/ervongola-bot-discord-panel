# Pubblicare il pannello su Vercel (piano Hobby, gratis)

Due progetti Vercel dallo stesso repository + uno store **Vercel Blob** dove vivono film, utenti,
frasi json e mp3. Il bot resta dove sta (Portainer): i log li guardi lì.

```
Browser ──> Frontend (Vercel, root ".")  ──VITE_API_URL──>  Backend Flask (Vercel, root "api")
                                                                  │
                                                                  ▼
                                                        Vercel Blob (privato)
                                                                  ▲
Bot (Pi) ── tools/bot_sync.py (ogni ora, pull con BOT_SYNC_TOKEN) ┘
```

## 1. Store Blob
Vercel → Storage → Create → **Blob** → accesso **Private**. Collegalo al progetto backend
(crea `BLOB_READ_WRITE_TOKEN`). `BLOB_ACCESS` (default `private`) deve coincidere con la modalità dello store.

## 2. Progetto backend
New Project → stesso repo → **Root Directory = `api`**. Variabili d'ambiente:

| Variabile | Valore |
|---|---|
| `SECRET_KEY` | stringa lunga casuale (**obbligatoria**: senza, l'app non parte su Vercel) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | l'admin fisso (hash, non la password) |
| `CORS_ALLOWED_ORIGINS` | URL del frontend, es. `https://tuo-pannello.vercel.app` |
| `CORS_ALLOWED_ORIGIN_REGEX` | facoltativa, per le **preview** (indirizzo diverso a ogni deploy): `https://ervongola-dashboard-[a-z0-9-]+-alexssio07s-projects\.vercel\.app` (copre sia `-git-<branch>-` sia gli indirizzi con hash; deve combaciare con tutto l'indirizzo) |
| `ALLOW_REGISTRATION` | facoltativa: in **produzione la registrazione è sempre chiusa** (solo login con l'admin sopra); nelle preview e in locale è aperta, `false` la chiude anche lì |
| `BOT_SYNC_TOKEN` | stringa casuale; la stessa va nel bot (`PANEL_SYNC_TOKEN`) |
| `TMDB_API_KEY` | per la ricerca film |
| `DISCORD_TOKEN`, `MOVIES_FORUM_CHANNEL_ID` | solo se usi la sincronizzazione col forum: valuta se tenere il token del bot su Vercel |
| `BOT_CONTROL_URL`, `BOT_CONTROL_TOKEN` | opzionali, vedi "Limiti" |

## 3. Progetto frontend
New Project → stesso repo → **Root Directory = `.`**. Variabile: `VITE_API_URL=https://IL-TUO-BACKEND.vercel.app`
(vedi `.env.example`). `vercel.json` gestisce la riscrittura SPA.

## 4. Prova dello store (consigliata, 1 minuto)
Dal PC, con il token preso da Storage → il tuo store → `.env.local`:
```
pip install vercel-blob python-dotenv
set BLOB_READ_WRITE_TOKEN=...
python tools/blob_selftest.py
```
Tutto deve dare OK, in particolare "lettura fresca … legge la v2". Se qualcosa fallisce non pubblicare.

## 5. Caricare i dati esistenti
```
python tools/upload_to_blob.py --db api/data/panel.db --json-dir ../json --audio-dir ../audio_files --dry-run
python tools/upload_to_blob.py --db api/data/panel.db --json-dir ../json --audio-dir ../audio_files
```
Si può rilanciare: i documenti già presenti non sono sovrascritti (serve `--force`), gli audio uguali sono saltati.
Gli mp3 grandi si caricano **solo** da qui: il pannello su Vercel ha un limite di 4,5 MB per richiesta.

## 6. Allineare il bot
Sul Pi (stesso container/cartella del bot), con `PANEL_SYNC_URL` e `PANEL_SYNC_TOKEN`:
```
python tools/bot_sync.py --json-dir json --audio-dir audio_files --interval 3600
```
I contatori `users` di `frasieffetto.json` scritti dal bot **restano locali** e non vengono sovrascritti.
Le modifiche del pannello arrivano al bot con il ritardo dell'intervallo. Gli audio tolti dal pannello non sono cancellati dal bot.
Nel bot rimuovi le variabili `PANEL_LOG_*` (i log non passano più dal pannello). Il vecchio pannello sul Pi non legge più `panel.db`.

## Backup e ripristino dei film dal pannello
Nel pannello: **Film → Backup**.
- **Scarica backup**: salva il catalogo in un file JSON sul tuo computer.
- **Ripristina da file**: *Aggiungi i film mancanti* (consigliato; i già presenti sono saltati e gli elementi non validi segnalati) oppure *Sostituisci tutto*, che prima salva una copia di sicurezza del catalogo nello store (`data/backups/movies-<data>.json`, visibile da Vercel → Storage).
- Per portare i film del **vecchio pannello** (`panel.db`): `python tools/db_to_backup.py --db percorso/panel.db`, poi caricare `film-backup.json` da "Ripristina da file".
- Limite: file fino a 4 MB e 5.000 film per ripristino.

## Backup dei dati su Git
```
python tools/export_from_blob.py            # film + frasi in backup/data e backup/json
git add backup && git commit -m "Backup dati pannello" && git push
```
- Gli utenti (hash delle password) sono esclusi: `--include-users` solo se il repository è **privato**.
- Gli mp3 sono esclusi: `--audio` li scarica in `backup/audio`; GitHub rifiuta file oltre 100 MB.
- I file sono riscritti solo se cambiano, quindi i commit mostrano le modifiche vere.
- Ripristino: `python tools/upload_to_blob.py --data-dir backup/data --json-dir backup/json --audio-dir backup/audio --force`

## Quota Hobby (Blob)
1 GB di spazio, 10.000 operazioni semplici/mese, 2.000 avanzate (put/list), 10 GB di trasferimento; superarle blocca Blob per 30 giorni.
Per questo: nessun polling, cache in memoria, elenco audio in cache 1 h, sync del bot ogni ora, salvataggi solo quando cambia qualcosa.
Dopo una modifica un'altra istanza può vedere il dato vecchio fino a ~60 s (cache CDN); le modifiche usano sempre una lettura fresca, quindi non si perdono.

## Limiti
- **Controllo vocale** (connetti/riproduci/stop/TTS) richiede un `BOT_CONTROL_URL` raggiungibile da internet; senza, il pannello mostra "Controllo del bot non attivo". Elenco audio e ascolto nel browser funzionano comunque.
- L'`id` degli audio nel pannello non coincide più con `/list_audio_commands` del bot (ora è la posizione nell'elenco ordinato).
- Il feed attività non è in tempo reale: si aggiorna all'apertura, al ritorno sulla scheda e dopo ogni tua modifica.
- Le pagine dei log non esistono più (file in `_to_delete/`).
- I file `*.bak` e `data/` non vengono pubblicati (`.vercelignore`).
