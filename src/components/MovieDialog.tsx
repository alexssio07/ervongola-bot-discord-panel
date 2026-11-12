import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import MovieIcon from "@mui/icons-material/Movie";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ScheduleIcon from "@mui/icons-material/Schedule";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { getMovieProviders, type Movie, type MovieProviders, type MovieStatus, type WatchProvider } from "../api/movies";
import { apiErrorMessage } from "../api/client";
import { formatRuntime } from "./MovieStats";

export const STATUS_META: Record<
  MovieStatus,
  { label: string; color: "success" | "warning"; icon: typeof CheckCircleIcon }
> = {
  visto: { label: "Visto", color: "success", icon: CheckCircleIcon },
  da_guardare: { label: "Da guardare", color: "warning", icon: ScheduleIcon },
};

/** "2026-09-12" -> "12/09/2026" */
export function formatWatchedDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("it-IT", { dateStyle: "long", timeStyle: "short" });
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ wordBreak: "break-word" }}>
        {children}
      </Typography>
    </Box>
  );
}

const simplify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Prime" (scritto nel film) corrisponde a "Amazon Prime Video" (TMDB), e viceversa. */
function samePlatform(mine: string, theirs: string): boolean {
  const a = simplify(mine);
  const b = simplify(theirs);
  return a !== "" && b !== "" && (a.includes(b) || b.includes(a));
}

function ProviderGroup({ title, providers, mine }: { title: string; providers: WatchProvider[]; mine: string }) {
  if (providers.length === 0) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        {providers.map((p) => {
          const isMine = samePlatform(mine, p.name);
          return (
            <Chip
              key={p.name}
              avatar={p.logo ? <Avatar alt="" src={p.logo} variant="rounded" /> : undefined}
              label={p.name}
              color={isMine ? "success" : "default"}
              variant={isMine ? "filled" : "outlined"}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

/** "Dove guardarlo": piattaforme in cui il film è disponibile oggi (dati JustWatch via TMDB). */
function WatchProviders({ movie }: { movie: Movie }) {
  const [data, setData] = useState<MovieProviders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const mySeq = ++seq.current; // scarta le risposte di un film aperto prima
    setLoading(true);
    setError(null);
    setData(null);
    getMovieProviders(movie.id)
      .then((result) => {
        if (mySeq === seq.current) setData(result);
      })
      .catch((err) => {
        if (mySeq === seq.current) setError(apiErrorMessage(err, "Ricerca delle piattaforme non riuscita."));
      })
      .finally(() => {
        if (mySeq === seq.current) setLoading(false);
      });
  }, [movie.id]);

  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`${movie.title} ${movie.release_year} streaming`)}`;
  const streaming = [...(data?.flatrate ?? []), ...(data?.free ?? [])];

  return (
    <Stack spacing={1.5} sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Dove guardarlo{data?.region ? ` (${data.region})` : ""}
      </Typography>

      {loading && (
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Cerco sulle piattaforme…
          </Typography>
        </Stack>
      )}

      {error && (
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
      )}

      {data && !data.found && (
        <Typography variant="body2" color="text.secondary">
          Film non riconosciuto su TMDB: impossibile sapere dove è disponibile.
        </Typography>
      )}

      {data?.found && (
        <>
          {data.exact === false && (
            <Typography variant="body2" color="warning.main">
              Trovato per somiglianza: «{data.tmdb_title}» ({data.tmdb_year}). Controlla che sia il film giusto.
            </Typography>
          )}
          <ProviderGroup title="In streaming (abbonamento)" providers={data.flatrate ?? []} mine={movie.platform} />
          <ProviderGroup title="Gratis (con pubblicità)" providers={data.free ?? []} mine={movie.platform} />
          <ProviderGroup title="Noleggio" providers={data.rent ?? []} mine={movie.platform} />
          <ProviderGroup title="Acquisto" providers={data.buy ?? []} mine={movie.platform} />
          {streaming.length === 0 && (data.rent?.length ?? 0) + (data.buy?.length ?? 0) === 0 && (
            <Typography variant="body2" color="text.secondary">
              Non risulta disponibile su nessuna piattaforma in questo paese.
            </Typography>
          )}
          {streaming.length === 0 && (data.rent?.length ?? 0) + (data.buy?.length ?? 0) > 0 && (
            <Typography variant="body2" color="text.secondary">
              Non è incluso in nessun abbonamento: solo noleggio o acquisto.
            </Typography>
          )}
        </>
      )}

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
        {data?.link && (
          <Button size="small" startIcon={<OpenInNewIcon />} href={data.link} target="_blank" rel="noopener noreferrer">
            Tutte le opzioni (JustWatch)
          </Button>
        )}
        <Button size="small" startIcon={<OpenInNewIcon />} href={googleUrl} target="_blank" rel="noopener noreferrer">
          Cerca su altri siti
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Disponibilità fornite da JustWatch tramite TMDB; possono non essere aggiornate al giorno.
      </Typography>
    </Stack>
  );
}

interface Props {
  movie: Movie | null;
  onClose: () => void;
}

/** Popup con tutti i dettagli del film, incluso chi l'ha aggiunto e chi l'ha proposto. */
export default function MovieDialog({ movie, onClose }: Props) {
  const meta = movie ? STATUS_META[movie.status] : null;
  const StatusIcon = meta?.icon;
  const genres = movie ? movie.genre.split(",").map((g) => g.trim()).filter(Boolean) : [];

  return (
    <Dialog open={movie !== null} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="movie-dialog-title">
      {movie && meta && StatusIcon && (
        <>
          <IconButton
            aria-label="Chiudi"
            onClick={onClose}
            sx={{ position: "absolute", right: 8, top: 8, bgcolor: "background.paper", zIndex: 1 }}
          >
            <CloseIcon />
          </IconButton>

          <DialogContent sx={{ p: 0 }}>
            <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" } }}>
              <Box
                sx={{
                  flexShrink: 0,
                  width: { xs: "100%", md: 300 },
                  minHeight: { xs: 220, md: 440 },
                  bgcolor: "action.hover",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {movie.cover_url ? (
                  <Box
                    component="img"
                    src={movie.cover_url}
                    alt={`Copertina di ${movie.title}`}
                    sx={{ width: "100%", height: "100%", objectFit: "cover", maxHeight: { xs: 360, md: "none" } }}
                  />
                ) : (
                  <MovieIcon sx={{ fontSize: 80, opacity: 0.4 }} />
                )}
              </Box>

              <Stack spacing={2.5} sx={{ p: { xs: 3, md: 4 }, flexGrow: 1, minWidth: 0 }}>
                <Typography id="movie-dialog-title" variant="h5" component="h2" sx={{ fontWeight: 700, pr: 5 }}>
                  {movie.title}
                </Typography>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip icon={<StatusIcon />} label={meta.label} color={meta.color} />
                  {movie.platform && <Chip label={movie.platform} variant="outlined" />}
                  {genres.map((g) => (
                    <Chip key={g} label={g} variant="outlined" />
                  ))}
                </Stack>

                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  }}
                >
                  <InfoRow label="Data di visione">
                    {movie.watched_at ? formatWatchedDate(movie.watched_at) : "—"}
                  </InfoRow>
                  {movie.collection && (
                    <InfoRow label="Saga">
                      {movie.collection}
                      {movie.collection_size && movie.collection_size > 1
                        ? ` (${movie.collection_seen ?? 0} di ${movie.collection_size} visti)`
                        : ""}
                    </InfoRow>
                  )}
                  {movie.release_year && <InfoRow label="Anno di uscita">{movie.release_year}</InfoRow>}
                  {movie.runtime > 0 && <InfoRow label="Durata">{formatRuntime(movie.runtime)}</InfoRow>}
                  <InfoRow label="Proposto da">{movie.proposed_by || "—"}</InfoRow>
                  <InfoRow label="Aggiunto da">{movie.added_by || "— (inserito prima del tracciamento)"}</InfoRow>
                  <InfoRow label="Aggiunto il">{formatDateTime(movie.created_at) || "—"}</InfoRow>
                </Box>

                {movie.notes && <InfoRow label="Note">{movie.notes}</InfoRow>}

                <WatchProviders movie={movie} />
              </Stack>
            </Box>
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
            {movie.link && (
              <Button
                startIcon={<OpenInNewIcon />}
                href={movie.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Guarda
              </Button>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              component={RouterLink}
              to={`/movies/${movie.id}`}
            >
              Modifica
            </Button>
            <Button variant="contained" onClick={onClose}>
              Chiudi
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
