import AddCircleIcon from "@mui/icons-material/AddCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { Avatar, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useRef, type ReactNode } from "react";
import { useActivityStream, type ActivityConnection, type ActivityEvent } from "../hooks/useActivityStream";

const SCOPE_LABEL: Record<string, string> = {
  frasiaddio: "Frasi d'addio",
  frasieffetto: "Frasi d'effetto",
  blasfemia: "Blasfemie",
  movies: "Film",
};

const SCOPE_NOUN: Record<string, string> = {
  frasiaddio: "una frase",
  frasieffetto: "una frase",
  blasfemia: "una bestemmia",
  movies: "un film",
};

const ACTION_META = {
  add: { verb: "ha aggiunto", Icon: AddCircleIcon },
  update: { verb: "ha modificato", Icon: EditIcon },
  delete: { verb: "ha eliminato", Icon: DeleteIcon },
} as const;

// Palette Okabe-Ito: distinguibile anche con daltonismo.
const USER_COLORS = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"];

function userColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("it-IT");
}

const CONNECTION_META: Record<ActivityConnection, { label: string; color: string }> = {
  connecting: { label: "Caricamento...", color: "warning.main" },
  live: { label: "Aggiornato", color: "success.main" },
  error: { label: "Non aggiornato", color: "error.main" },
};

interface FeedProps {
  events: ActivityEvent[];
  connection: ActivityConnection;
}

export function ActivityFeed({ events, connection }: FeedProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Stile chat: i nuovi eventi arrivano in basso; si scorre da soli solo se
  // l'utente era già in fondo (non gli si strappa via la lettura dello storico).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column", height: "75vh", minHeight: 420 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Attività svolte
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cosa hanno aggiunto, modificato o eliminato gli utenti del pannello. Si aggiorna quando apri la pagina, torni su questa scheda o fai una modifica.
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <FiberManualRecordIcon sx={{ fontSize: 14, color: CONNECTION_META[connection].color }} />
          <Typography variant="body2" color="text.secondary">
            {CONNECTION_META[connection].label}
          </Typography>
        </Stack>
      </Stack>

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: "auto", p: 2 }}>
        {events.length === 0 ? (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            Nessuna attività recente. Qui vedrai chi aggiunge, modifica o elimina elementi.
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {events.map((e) => {
              const { verb, Icon } = ACTION_META[e.action] ?? ACTION_META.update;
              return (
                <Stack key={`${e.boot}:${e.id}`} direction="row" spacing={1.5} alignItems="flex-start">
                  <Avatar sx={{ bgcolor: userColor(e.user), width: 36, height: 36, fontWeight: 700 }}>
                    {e.user.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body1" sx={{ wordBreak: "break-word" }}>
                      <b>{e.user}</b> {verb} {SCOPE_NOUN[e.scope] ?? "un elemento"}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 0.5 }} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        icon={<Icon fontSize="small" />}
                        label={SCOPE_LABEL[e.scope] ?? e.scope}
                        variant="outlined"
                      />
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(e.timestamp)}
                      </Typography>
                    </Stack>
                    {e.text && (
                      <Typography
                        variant="body2"
                        sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.25, py: 0.75, wordBreak: "break-word" }}
                      >
                        {e.action === "update" && e.old_text ? (
                          <>
                            <s>{e.old_text}</s> → {e.text}
                          </>
                        ) : (
                          e.text
                        )}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

interface LayoutProps {
  children: ReactNode;
  onLiveEvent?: (event: ActivityEvent) => void;
  /** Riquadro opzionale in una colonna a sinistra (appiccicata, scorre da sola) */
  leftPanel?: ReactNode;
}

/** Contenuto della pagina al centro, riquadro chat con gli eventi a destra e,
 * se presente, un riquadro laterale a sinistra (sugli schermi stretti si
 * impilano). */
export default function ActivityLayout({ children, onLiveEvent, leftPanel }: LayoutProps) {
  const { events, connection } = useActivityStream(onLiveEvent);
  return (
    <Box
      sx={{
        display: "grid",
        gap: { xs: 2, lg: 2.5 },
        // Pagina a tutta larghezza: le colonne laterali crescono un po' con lo
        // schermo ma restano sempre molto più strette di quella centrale (1fr).
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          lg: leftPanel
            ? "clamp(240px, 17vw, 340px) minmax(0, 1fr) clamp(280px, 20vw, 400px)"
            : "minmax(0, 1fr) clamp(280px, 22vw, 420px)",
        },
        alignItems: "start",
      }}
    >
      {leftPanel && <Box sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>{leftPanel}</Box>}
      <Box sx={{ minWidth: 0 }}>{children}</Box>
      <Box sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>
        <ActivityFeed events={events} connection={connection} />
      </Box>
    </Box>
  );
}
