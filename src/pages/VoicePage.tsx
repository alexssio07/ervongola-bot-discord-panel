import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import HeadphonesIcon from "@mui/icons-material/Headphones";
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import StopIcon from "@mui/icons-material/Stop";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage } from "../api/client";
import {
  connectVoice,
  disconnectVoice,
  fetchAudioFile,
  getVoiceStatus,
  listAudioFiles,
  listVoiceChannels,
  playAudio,
  stopAudio,
  type AudioFile,
  type VoiceChannel,
  type VoiceStatus,
} from "../api/voice";
import SearchField from "../components/SearchField";

const STATUS_POLL_MS = 3000;
const STORAGE_KEY = "ervongola_voice_channel";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function savedChannel(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function VoicePage() {
  const [files, setFiles] = useState<AudioFile[] | null>(null);
  const [channels, setChannels] = useState<VoiceChannel[]>([]);
  const [channelId, setChannelId] = useState<string>(savedChannel());
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Anteprima nel browser (indipendente dal bot): nome del file in ascolto / in caricamento.
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const previewUrl = useRef<string | null>(null);
  const previewToken = useRef(0);
  const statusTimer = useRef<number | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getVoiceStatus();
      setStatus(next);
      // Backend senza server di controllo del bot: inutile interrogarlo ogni pochi secondi.
      if (next.configured === false && statusTimer.current !== null) {
        window.clearInterval(statusTimer.current);
        statusTimer.current = null;
      }
    } catch (err) {
      setStatus({ available: false, connected: false, playing: false, error: apiErrorMessage(err) });
    }
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const data = await listVoiceChannels();
      setChannels(data);
      setChannelId((current) => (data.some((c) => c.id === current) ? current : ""));
    } catch {
      // bot non pronto: il polling dello stato mostra gia' l'avviso, riprovo con "Aggiorna".
      setChannels([]);
    }
  }, []);

  useEffect(() => {
    listAudioFiles()
      .then(setFiles)
      .catch((err) => {
        setFiles([]);
        setError(apiErrorMessage(err, "Impossibile caricare l'elenco degli audio."));
      });
    void loadChannels();
    void refreshStatus();
    statusTimer.current = window.setInterval(refreshStatus, STATUS_POLL_MS);
    return () => {
      if (statusTimer.current !== null) window.clearInterval(statusTimer.current);
      statusTimer.current = null;
    };
  }, [loadChannels, refreshStatus]);

  const stopPreview = useCallback(() => {
    previewToken.current += 1; // annulla un eventuale caricamento in corso
    previewAudio.current?.pause();
    previewAudio.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreviewing(null);
    setPreviewLoading(null);
  }, []);

  useEffect(() => stopPreview, [stopPreview]);

  async function togglePreview(name: string) {
    if (previewing === name || previewLoading === name) {
      stopPreview();
      return;
    }
    stopPreview();
    const token = previewToken.current;
    setPreviewLoading(name);
    try {
      const blob = await fetchAudioFile(name);
      if (token !== previewToken.current) return; // nel frattempo l'utente ha fermato o cambiato audio
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = stopPreview;
      audio.onerror = () => {
        setError("Impossibile riprodurre questo audio nel browser.");
        stopPreview();
      };
      previewUrl.current = url;
      previewAudio.current = audio;
      setPreviewLoading(null);
      setPreviewing(name);
      await audio.play();
    } catch (err) {
      if (token === previewToken.current) {
        setError(apiErrorMessage(err, "Impossibile ascoltare questo audio."));
        stopPreview();
      }
    }
  }

  // Se il bot e' gia' dentro un canale, il selettore lo segue.
  useEffect(() => {
    if (status?.connected && status.channel_id) setChannelId(status.channel_id);
  }, [status?.connected, status?.channel_id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (files ?? []).filter((f) => !q || f.title.toLowerCase().includes(q));
  }, [files, search]);

  async function run(action: () => Promise<void>, pending?: "connect" | "disconnect") {
    setError(null);
    if (pending) setBusy(pending);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      if (pending) setBusy(null);
      await refreshStatus();
    }
  }

  function handleChannelChange(id: string) {
    setChannelId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage non disponibile: la scelta vale solo per questa sessione
    }
  }

  const botDown = status !== null && !status.available;
  const connected = !!status?.connected;

  return (
    <Box sx={{ maxWidth: 900, mx: "auto" }}>
      <Typography variant="h5" component="h1" gutterBottom>
        Audio
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <FormControl size="small" sx={{ minWidth: 240, flexGrow: 1 }} disabled={connected || busy !== null}>
            <InputLabel id="voice-channel-label">Canale vocale</InputLabel>
            <Select
              labelId="voice-channel-label"
              label="Canale vocale"
              value={channelId}
              onChange={(e) => handleChannelChange(e.target.value)}
            >
              {channels.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                  {c.members > 0 ? ` (${c.members} connessi)` : ""}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Tooltip title="Ricarica i canali">
            <span>
              <IconButton onClick={() => void loadChannels()} aria-label="Ricarica i canali">
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>

          {connected ? (
            <Button
              variant="outlined"
              color="error"
              startIcon={busy === "disconnect" ? <CircularProgress size={18} /> : <LinkOffIcon />}
              disabled={busy !== null}
              onClick={() => void run(disconnectVoice, "disconnect")}
            >
              Disconnetti
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={busy === "connect" ? <CircularProgress size={18} color="inherit" /> : <HeadsetMicIcon />}
              disabled={!channelId || busy !== null || botDown}
              onClick={() => void run(() => connectVoice(channelId), "connect")}
            >
              Connetti
            </Button>
          )}

          <Button
            variant="outlined"
            startIcon={<StopIcon />}
            disabled={!status?.playing}
            onClick={() => void run(stopAudio)}
          >
            Stop
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }} flexWrap="wrap">
          {status?.configured === false ? (
            <Chip label="Controllo del bot non attivo" />
          ) : botDown ? (
            <Chip color="warning" label="Bot non raggiungibile" />
          ) : connected ? (
            <Chip color="success" label={`Connesso a ${status?.channel_name ?? "?"}`} />
          ) : (
            <Chip label="Non connesso" />
          )}
          {status?.playing && status.now_playing && (
            <Chip
              color="primary"
              icon={<GraphicEqIcon />}
              label={`In riproduzione: ${status.now_playing.replace(/\.[^.]+$/, "")}`}
            />
          )}
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {botDown && status?.error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {status.error}
        </Alert>
      )}
      {!connected && !botDown && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Scegli un canale e premi “Connetti” per poter riprodurre gli audio.
        </Alert>
      )}

      <Box sx={{ mb: 2 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Cerca un audio..." />
      </Box>

      {files === null ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper>
          <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, pt: 1.5 }}>
            {filtered.length} / {files.length} audio
          </Typography>
          <List disablePadding>
            {filtered.map((file, index) => {
              const isPlaying = status?.playing && status.now_playing === file.name;
              return (
                <ListItem
                  key={file.name}
                  disablePadding
                  divider
                  secondaryAction={
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ pr: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ pr: 0.5 }}>
                        {formatSize(file.size)}
                      </Typography>
                      <Tooltip title={previewing === file.name ? "Ferma l'ascolto" : "Ascolta qui nel browser"}>
                        <IconButton
                          size="small"
                          onClick={() => void togglePreview(file.name)}
                          aria-label={`${previewing === file.name ? "Ferma" : "Ascolta"} ${file.title}`}
                        >
                          {previewLoading === file.name ? (
                            <CircularProgress size={18} />
                          ) : previewing === file.name ? (
                            <StopIcon fontSize="small" color="primary" />
                          ) : (
                            <HeadphonesIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <ListItemButton
                    selected={!!isPlaying}
                    disabled={!connected}
                    onClick={() => void run(() => playAudio(file.name))}
                    sx={{ pr: 15 }}
                  >
                    <Box sx={{ width: 40, display: "flex", justifyContent: "center", color: "text.secondary" }}>
                      {isPlaying ? (
                        <GraphicEqIcon color="primary" />
                      ) : connected ? (
                        <PlayArrowIcon />
                      ) : (
                        <Typography variant="body2">{index + 1}</Typography>
                      )}
                    </Box>
                    <ListItemText
                      primary={file.title}
                      slotProps={{ primary: { sx: { fontWeight: isPlaying ? 700 : 400, wordBreak: "break-word" } } }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
            {filtered.length === 0 && (
              <ListItem>
                <ListItemText primary="Nessun audio trovato." />
              </ListItem>
            )}
          </List>
        </Paper>
      )}
    </Box>
  );
}
