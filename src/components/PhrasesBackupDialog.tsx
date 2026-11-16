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
  downloadPhrasesBackup,
  restorePhrasesBackup,
  type PhrasesRestoreMode,
  type PhrasesRestoreResult,
} from "../api/phrases";
import { useAuth } from "../context/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chiamata dopo un ripristino riuscito, per ricaricare l'elenco. */
  onRestored: () => void;
}

/** Scarica tutte le frasi come file e le ripristina da file (unendo o sostituendo). */
export default function PhrasesBackupDialog({ open, onClose, onRestored }: Props) {
  // Scaricare il backup e' una lettura; il ripristino modifica le frasi e richiede la scrittura.
  const { can } = useAuth();
  const canRestore = can("phrases", "write");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<PhrasesRestoreMode>("merge");
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhrasesRestoreResult | null>(null);

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
      await downloadPhrasesBackup();
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
        "Sostituire le frasi con il contenuto del file?\n\nPer ogni file presente nel backup, le frasi attuali che non sono nel file saranno rimosse (ne viene salvata una copia di sicurezza)."
      )
    ) {
      return;
    }
    setRestoring(true);
    setError(null);
    setResult(null);
    try {
      setResult(await restorePhrasesBackup(file, mode));
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onRestored();
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante il ripristino."));
    } finally {
      setRestoring(false);
    }
  }

  const outcomes = result ? Object.values(result.files) : [];

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        Backup delle frasi
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
              Un unico file .json con tutte le frasi: d'addio, d'effetto e blasfemie.
            </Typography>
            <Button
              variant="contained"
              startIcon={downloading ? <CircularProgress size={20} color="inherit" /> : <DownloadIcon />}
              onClick={handleDownload}
              disabled={busy}
            >
              Scarica backup
            </Button>
          </Box>

          {canRestore && (
            <>
              <Divider />

              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }} gutterBottom>
                  Ripristina da file
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Scegli un file di backup delle frasi (.json) scaricato da questo pannello.
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

                <RadioGroup
                  value={mode}
                  onChange={(e) => setMode(e.target.value as PhrasesRestoreMode)}
                  sx={{ mt: 1.5 }}
                >
                  <FormControlLabel
                    value="merge"
                    control={<Radio size="small" />}
                    disabled={busy}
                    label="Aggiungi le frasi mancanti (consigliato): quelle già presenti vengono saltate"
                  />
                  <FormControlLabel
                    value="replace"
                    control={<Radio size="small" />}
                    disabled={busy}
                    label="Sostituisci le frasi con il contenuto del file"
                  />
                </RadioGroup>
                {mode === "replace" && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Le frasi attuali che non sono nel file verranno rimosse. Prima di sostituire, il pannello salva una
                    copia di ogni lista.
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
            </>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {result && (
            <Alert severity={outcomes.some((o) => o.invalid_count > 0) ? "warning" : "success"}>
              {outcomes.map((o) => (
                <Typography key={o.label} variant="body2" sx={{ mb: 0.5 }}>
                  <strong>{o.label}</strong>:{" "}
                  {result.mode === "replace"
                    ? `sostituite con ${o.added} frasi`
                    : `${o.added} aggiunte, ${o.duplicates} già presenti`}
                  {o.invalid_count > 0 &&
                    `, ${o.invalid_count} ${o.invalid_count === 1 ? "elemento non importabile" : "elementi non importabili"} (#${o.invalid.map((i) => i.index).join(", #")}${o.invalid_count > o.invalid.length ? "…" : ""})`}
                  . Totale: {o.total}.
                  {o.safety_copy && ` Copia precedente: ${o.safety_copy}`}
                </Typography>
              ))}
            </Alert>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
