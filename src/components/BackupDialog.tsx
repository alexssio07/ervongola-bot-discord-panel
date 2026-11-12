import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from "@mui/material";
import { useRef, useState } from "react";
import { apiErrorMessage } from "../api/client";
import {
  downloadMoviesBackup,
  restoreMoviesBackup,
  type RestoreMode,
  type RestoreResult,
} from "../api/movies";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chiamata dopo un ripristino riuscito, per ricaricare l'elenco. */
  onRestored: () => void;
}

/** Scarica il catalogo come file e lo ripristina da file (unendo o sostituendo). */
export default function BackupDialog({ open, onClose, onRestored }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const busy = downloading || restoring;

  function handleClose() {
    if (busy) return;
    setFile(null);
    setMode("merge");
    setError(null);
    setResult(null);
    onClose();
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadMoviesBackup();
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante il download del backup."));
    } finally {
      setDownloading(false);
    }
  }

  async function handleRestore() {
    if (!file) return;
    if (
      mode === "replace" &&
      !window.confirm(
        "Sostituire TUTTO il catalogo con il contenuto del file?\n\nI film attuali non presenti nel file saranno rimossi (ne viene salvata una copia di sicurezza)."
      )
    ) {
      return;
    }
    setRestoring(true);
    setError(null);
    setResult(null);
    try {
      setResult(await restoreMoviesBackup(file, mode));
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onRestored();
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante il ripristino."));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        Backup dei film
        <IconButton
          aria-label="Chiudi"
          onClick={handleClose}
          disabled={busy}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
              Scarica un backup
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Salva tutto il catalogo in un file JSON sul tuo computer.
            </Typography>
            <Button
              variant="outlined"
              startIcon={downloading ? <CircularProgress size={20} /> : <DownloadIcon />}
              onClick={handleDownload}
              disabled={busy}
            >
              Scarica backup
            </Button>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
              Ripristina da file
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Scegli un file di backup (.json), anche prodotto dal vecchio pannello con lo script di conversione.
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
            />
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                Scegli file
              </Button>
              <Typography variant="body2" color={file ? "text.primary" : "text.secondary"}>
                {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : "Nessun file scelto"}
              </Typography>
            </Stack>

            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as RestoreMode)} sx={{ mt: 1.5 }}>
              <FormControlLabel
                value="merge"
                control={<Radio size="small" />}
                disabled={busy}
                label="Aggiungi i film mancanti (consigliato): quelli già presenti vengono saltati"
              />
              <FormControlLabel
                value="replace"
                control={<Radio size="small" />}
                disabled={busy}
                label="Sostituisci tutto il catalogo con il contenuto del file"
              />
            </RadioGroup>
            {mode === "replace" && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                I film attuali che non sono nel file verranno rimossi. Prima di sostituire, il pannello salva una copia
                del catalogo attuale.
              </Alert>
            )}

            <Button
              variant="contained"
              sx={{ mt: 2 }}
              startIcon={restoring ? <CircularProgress size={20} color="inherit" /> : <UploadFileIcon />}
              onClick={handleRestore}
              disabled={!file || busy}
            >
              Ripristina
            </Button>
          </Box>

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {result && (
            <Alert severity={result.invalid_count > 0 ? "warning" : "success"}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {result.mode === "replace"
                  ? `Catalogo sostituito: ${result.added} film.`
                  : `Aggiunti ${result.added} film, ${result.skipped_duplicates} già presenti saltati.`}{" "}
                Ora il catalogo ne contiene {result.total}.
              </Typography>
              {result.skipped_titles.length > 0 && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Già presenti: {result.skipped_titles.join(", ")}
                  {result.skipped_duplicates > result.skipped_titles.length ? "…" : ""}
                </Typography>
              )}
              {result.invalid_count > 0 && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {result.invalid_count} {result.invalid_count === 1 ? "elemento non importabile" : "elementi non importabili"}:{" "}
                  {result.invalid.map((i) => `#${i.index}${i.title ? ` «${i.title}»` : ""} (${i.error})`).join("; ")}
                  {result.invalid_count > result.invalid.length ? "…" : ""}
                </Typography>
              )}
              {result.safety_copy && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Copia del catalogo precedente salvata nello store: {result.safety_copy}
                </Typography>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
