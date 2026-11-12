# Pannello Er Vongola

Pannello web per gestire il bot Discord **Er Vongola**: catalogo film, editor delle frasi json
(addio, d'effetto, blasfemie), elenco e ascolto degli audio mp3, feed delle attività.

- **Frontend:** React 18 + TypeScript + Vite 7 + MUI v7 (cartella principale)
- **Backend:** Flask (`api/`), dati in JSON su disco in locale e su **Vercel Blob** in produzione
- **Bot:** resta sul proprio server; `tools/bot_sync.py` ne allinea frasi e audio

## Sviluppo in locale

```bash
# backend (archivio su disco in api/data/store)
cd api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # se presente; imposta almeno SECRET_KEY
flask --app app run --port 5000

# frontend (altro terminale, dalla cartella principale)
npm install
npm run dev
```

Il frontend usa `VITE_API_URL` (vedi `.env.example`); in locale può restare vuoto se il proxy Vite punta al backend.

## Pubblicazione su Vercel

Due progetti dallo stesso repository (backend con Root Directory `api`, frontend con Root Directory `.`)
più uno store Blob privato. Passi completi, variabili d'ambiente e quota gratuita in
**[VERCEL_DEPLOY.md](VERCEL_DEPLOY.md)**.

## Strumenti (`tools/`)

| Script | A cosa serve |
|---|---|
| `blob_selftest.py` | verifica lo store Blob reale prima di pubblicare |
| `upload_to_blob.py` | carica `panel.db`, json delle frasi e mp3 nello store |
| `db_to_backup.py` | converte il vecchio `panel.db` nel file da caricare con "Film > Backup > Ripristina da file" |
| `export_from_blob.py` | scarica da Blob film, frasi (e a richiesta audio) in `backup/` da committare su Git |
| `bot_sync.py` | sul bot: scarica frasi e audio modificati dal pannello |

## Sicurezza

Non committare mai `.env`, `api/.env` o `api/data/` (sono nel `.gitignore`): contengono `SECRET_KEY`,
l'hash della password admin e i dati del pannello. In produzione su Vercel la registrazione è sempre chiusa (solo login); è aperta solo in preview e in locale.
