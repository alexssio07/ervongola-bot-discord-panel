import { Box, Button, ButtonBase, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import type { MovieStats } from "../api/movies";

interface Props {
  stats: MovieStats | null;
  /** Generi attualmente filtrati (evidenziati): se ne possono scegliere più d'uno */
  activeGenres: string[];
  onToggleGenre: (genre: string) => void;
  onClearGenres: () => void;
}

const nf = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** 125 -> "2 h 5 min" */
export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/** Minuti -> ore, giorni, settimane, mesi e anni (decimali). Mese = 30,44 giorni, anno = 365,25. */
function conversions(minutes: number): { label: string; value: string }[] {
  const hours = minutes / 60;
  const days = hours / 24;
  return [
    { label: "ore", value: nf.format(hours) },
    { label: "giorni", value: nf.format(days) },
    { label: "settimane", value: nf.format(days / 7) },
    { label: "mesi", value: nf.format(days / 30.44) },
    { label: "anni", value: nf.format(days / 365.25) },
  ];
}

/** Composizione "esatta" in anni/mesi/giorni/ore/minuti (solo le unità non nulle). */
function breakdown(minutes: number): string {
  let rest = minutes;
  const parts: string[] = [];
  const units: [string, string, number][] = [
    ["mese", "mesi", Math.round(30.44 * 1440)],
    ["giorno", "giorni", 1440],
    ["ora", "ore", 60],
    ["minuto", "minuti", 1],
  ];
  for (const [one, many, size] of units) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.join(", ") || "0 minuti";
}

function BigNumber({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ textAlign: "center", flex: 1 }}>
      <Typography sx={{ fontSize: "1.9rem", fontWeight: 800, lineHeight: 1.1, color }}>{value}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}

function WatchTime({ stats }: { stats: MovieStats }) {
  const seen = conversions(stats.seen_minutes);
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Tempo di visione (film visti)
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        {seen.map((c) => (
          <Box key={c.label} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, textAlign: "center" }}>
            <Typography sx={{ fontWeight: 800, fontSize: "1.15rem", lineHeight: 1.2 }}>{c.value}</Typography>
            <Typography variant="caption" color="text.secondary">
              {c.label}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="body2" sx={{ mt: 1 }}>
        In pratica: <strong>{breakdown(stats.seen_minutes)}</strong>
      </Typography>
      {stats.unseen_minutes > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Ancora da guardare: {formatRuntime(stats.unseen_minutes)} ({nf.format(stats.unseen_minutes / 60 / 24)} giorni)
        </Typography>
      )}
      {stats.seen_without_runtime > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
          {stats.seen_without_runtime} film visti senza durata: non sono nel totale. Usa «Raggruppa saghe e durate» per completarli.
        </Typography>
      )}
    </Box>
  );
}

/** Riquadro laterale (a sinistra, a scorrimento) con i totali dei film visti /
 * da guardare e il dettaglio per genere. Cliccando un genere si filtra l'elenco. */
export default function MovieStatsPanel({ stats, activeGenres, onToggleGenre, onClearGenres }: Props) {
  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        maxHeight: { lg: "calc(100vh - 110px)" },
        borderWidth: 2,
        borderColor: "primary.main",
      }}
    >
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>
          Statistiche Film
        </Typography>
        {stats ? (
          <Stack direction="row" spacing={1}>
            <BigNumber label="Totali" value={stats.total} color="text.primary" />
            <BigNumber label="Visti" value={stats.seen} color="success.main" />
            <BigNumber label="Da guardare" value={stats.unseen} color="warning.main" />
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Caricamento…
          </Typography>
        )}
      </Box>

      {/* Parte a scorrimento: i generi possono essere molti */}
      <Box sx={{ overflowY: "auto", p: 2 }}>
        {stats && <WatchTime stats={stats} />}
        {stats && stats.by_genre.length > 0 ? (
          <>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Per genere (puoi sceglierne più di uno)
              </Typography>
              {activeGenres.length > 0 && (
                <Button size="small" onClick={onClearGenres}>
                  Azzera
                </Button>
              )}
            </Stack>
            <Stack spacing={1}>
              {stats.by_genre.map((g) => {
                const active = activeGenres.some((x) => x.toLowerCase() === g.genre.toLowerCase());
                return (
                  <ButtonBase
                    key={g.genre}
                    onClick={() => onToggleGenre(g.genre)}
                    aria-pressed={active}
                    sx={{
                      display: "block",
                      textAlign: "left",
                      p: 1.25,
                      borderRadius: 1,
                      border: active ? 3 : 1,
                      borderColor: active ? "primary.main" : "divider",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                      <Typography sx={{ fontWeight: 700 }}>{g.genre}</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{g.total}</Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={g.total ? (g.seen / g.total) * 100 : 0}
                      color="success"
                      sx={{ height: 6, borderRadius: 3, my: 0.75 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {g.seen} visti · {g.unseen} da guardare
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Stack>
          </>
        ) : (
          stats && (
            <Typography variant="body2" color="text.secondary">
              Nessun film ancora.
            </Typography>
          )
        )}
      </Box>
    </Paper>
  );
}
