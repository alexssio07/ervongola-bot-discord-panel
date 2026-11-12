import AddIcon from "@mui/icons-material/Add";
import BackupIcon from "@mui/icons-material/Backup";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LayersIcon from "@mui/icons-material/Layers";
import MovieIcon from "@mui/icons-material/Movie";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Checkbox,
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { apiErrorMessage } from "../../api/client";
import {
  backfillCollections,
  deleteMovie,
  getMovieFilterOptions,
  getMovieStats,
  getForumReport,
  listMovies,
  type Movie,
  type ForumReport,
  type MovieFilterOptions,
  type MovieSort,
  type MovieStats,
  type MovieStatus,
} from "../../api/movies";
import ActivityLayout from "../../components/ActivityFeed";
import BackupDialog from "../../components/BackupDialog";
import ForumReportDialog from "../../components/ForumReportDialog";
import MovieStatsPanel from "../../components/MovieStats";
import MovieDialog, { STATUS_META, formatWatchedDate } from "../../components/MovieDialog";
import SearchField from "../../components/SearchField";
import type { ActivityEvent } from "../../hooks/useActivityStream";

const SEARCH_DEBOUNCE_MS = 300;
// Minimo 20 elementi per pagina (24 si divide bene in 2/3/4 colonne).
const PAGE_SIZE_OPTIONS = [24, 48, 96, 192];


/** Aggiunge il valore selezionato alle opzioni se non c'è più (es. l'ultimo
 * film con quel genere è stato eliminato): evita una select con valore sconosciuto. */
function withSelected(options: string[], selected: string): string[] {
  return selected && !options.includes(selected) ? [...options, selected] : options;
}


type MovieBlock =
  | { kind: "saga"; name: string; movies: Movie[] }
  | { kind: "plain"; movies: Movie[] };

/** Raggruppa i film consecutivi della stessa saga (il backend li restituisce
 * già contigui); i film singoli consecutivi finiscono in un unico blocco. */
function buildBlocks(movies: Movie[]): MovieBlock[] {
  const blocks: MovieBlock[] = [];
  for (const movie of movies) {
    const inSaga = movie.collection !== "" && (movie.collection_size ?? 0) > 1;
    const last = blocks[blocks.length - 1];
    if (inSaga) {
      if (last?.kind === "saga" && last.name.toLowerCase() === movie.collection.toLowerCase()) {
        last.movies.push(movie);
      } else {
        blocks.push({ kind: "saga", name: movie.collection, movies: [movie] });
      }
    } else if (last?.kind === "plain") {
      last.movies.push(movie);
    } else {
      blocks.push({ kind: "plain", movies: [movie] });
    }
  }
  return blocks;
}

export default function MoviesListPage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<MovieStatus | "">("");
  const [platform, setPlatform] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<MovieSort>("recenti");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);

  const [stats, setStats] = useState<MovieStats | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupingNote, setGroupingNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [forumReport, setForumReport] = useState<ForumReport | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Ogni cambio di filtro o di quantità per pagina riparte dalla prima
  // pagina, altrimenti si potrebbe restare su una pagina che non esiste più
  // per i nuovi criteri (stesso pattern già usato in PhraseEditor).
  useEffect(() => {
    setPage(1);
  }, [status, platform, genres, search, sort, pageSize]);

  const [refreshing, setRefreshing] = useState(false);
  const [filterOptions, setFilterOptions] = useState<MovieFilterOptions>({
    genres: [],
    platforms: [],
    proposers: [],
    collections: [],
  });

  // silent = aggiornamento in background (senza spinner che svuota la griglia)
  async function reload(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await listMovies({ status, platform, genre: genres.join(","), search, sort }, page, pageSize);
      setMovies(data.items);
      setTotal(data.total);
      // Le opzioni delle select dipendono dai film presenti: si riallineano
      // a ogni caricamento (aggiunte/modifiche/eliminazioni, anche altrui).
      getMovieStats()
        .then(setStats)
        .catch(() => {
          // il riquadro numeri resta com'era: non è bloccante
        });
      getMovieFilterOptions()
        .then(setFilterOptions)
        .catch(() => {
          // le select restano con le opzioni precedenti: non è bloccante
        });
    } catch (err) {
      setError(apiErrorMessage(err, "Errore nel caricamento dei film."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Aggiornamento automatico quando qualcun altro cambia il catalogo film.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const handleLiveEvent = useCallback((event: ActivityEvent) => {
    if (event.scope === "movies") reloadRef.current(true);
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, platform, genres, search, sort, page, pageSize]);

  // Se il film aperto nel popup viene modificato (anche da altri), mostra i dati nuovi.
  useEffect(() => {
    setSelectedMovie((current) => (current ? (movies.find((m) => m.id === current.id) ?? current) : current));
  }, [movies]);

  // Se un'eliminazione svuota l'ultima pagina, torna indietro (come in PhraseEditor).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function handleDelete(movie: Movie) {
    if (!window.confirm(`Eliminare "${movie.title}" dal catalogo?`)) return;
    setDeletingId(movie.id);
    setError(null);
    try {
      await deleteMovie(movie.id);
      // Ricarica invece di filtrare in locale: con la paginazione, il totale
      // e il conteggio pagine vanno ricalcolati dal backend (es. eliminando
      // l'ultimo film di una pagina bisogna sapere se quella pagina esiste
      // ancora).
      await reload(true);
      setSelectedMovie((current) => (current?.id === movie.id ? null : current));
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante l'eliminazione."));
    } finally {
      setDeletingId(null);
    }
  }

  // Rileva saga, anno e durata dei film già presenti (inseriti prima di questa funzione).
  async function handleGroupSagas() {
    setGrouping(true);
    setError(null);
    setGroupingNote(null);
    let afterId: number | null = 0;
    let processed = 0;
    let withCollection = 0;
    let withRuntime = 0;
    const skipped: string[] = [];
    const approximate: string[] = [];
    try {
      // Un lotto per chiamata; tetto di sicurezza sulle ripetizioni.
      for (let i = 0; afterId !== null && i < 200; i++) {
        const result = await backfillCollections(afterId);
        processed += result.processed;
        withCollection += result.with_collection;
        withRuntime += result.with_runtime;
        skipped.push(...result.skipped);
        approximate.push(...result.approximate);
        afterId = result.next_after_id;
      }
      setGroupingNote(
        processed === 0
          ? "Tutti i film sono già stati analizzati."
          : `Analizzati ${processed} film: ${withCollection} assegnati a una saga, ${withRuntime} durate trovate` +
              (skipped.length > 0
                ? `. ${skipped.length} non riconosciuti automaticamente (puoi impostare la saga a mano dalla modifica): ${skipped
                    .slice(0, 10)
                    .join(", ")}${skipped.length > 10 ? "…" : ""}`
                : ".") +
              (approximate.length > 0
                ? ` Durata trovata per somiglianza del titolo (da verificare): ${approximate.slice(0, 10).join("; ")}${
                    approximate.length > 10 ? "…" : ""
                  }.`
                : "")
      );
      await reload(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante il raggruppamento delle saghe."));
    } finally {
      setGrouping(false);
    }
  }

  // Confronta il forum Discord col catalogo: solo un report, non importa nulla.
  async function handleSyncForum() {
    setSyncing(true);
    setError(null);
    try {
      setForumReport(await getForumReport(true));
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante la lettura del forum."));
    } finally {
      setSyncing(false);
    }
  }

  // Aggiunge/toglie un genere dal filtro (confronto senza distinzione maiuscole).
  const toggleGenre = (g: string) =>
    setGenres((prev) =>
      prev.some((x) => x.toLowerCase() === g.toLowerCase())
        ? prev.filter((x) => x.toLowerCase() !== g.toLowerCase())
        : [...prev, g]
    );

  // Una card film. Dichiarata qui per usarla sia nei blocchi saga sia nei film singoli.
  const renderMovieCard = (movie: Movie) => {
            const meta = STATUS_META[movie.status];
            const StatusIcon = meta.icon;
            return (
              <Grid key={movie.id} size={{ xs: 12, sm: 6, xl: 4 }}>
                <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <Tooltip title={movie.title} followCursor enterDelay={400} placement="top">
                  <CardActionArea
                    onClick={() => setSelectedMovie(movie)}
                    aria-label={`Apri i dettagli di ${movie.title}`}
                    sx={{
                      flexGrow: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      justifyContent: "flex-start",
                    }}
                  >
                  {movie.cover_url ? (
                    <CardMedia
                      component="img"
                      image={movie.cover_url}
                      alt={`Copertina di ${movie.title}`}
                      sx={{ height: 200, objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        height: 200,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "action.hover",
                      }}
                    >
                      <MovieIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                    </Box>
                  )}
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" component="h2" gutterBottom noWrap>
                      {movie.title}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1}>
                      <Chip
                        size="small"
                        icon={<StatusIcon fontSize="small" />}
                        label={meta.label}
                        color={meta.color}
                        variant="filled"
                      />
                      {movie.platform && <Chip size="small" label={movie.platform} variant="outlined" />}
                      {movie.genre && <Chip size="small" label={movie.genre} variant="outlined" />}
                    </Stack>
                    {movie.watched_at && (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Visto il {formatWatchedDate(movie.watched_at)}
                      </Typography>
                    )}
                    {movie.notes && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {movie.notes}
                      </Typography>
                    )}
                  </CardContent>
                  </CardActionArea>
                  </Tooltip>
                  <CardActions sx={{ justifyContent: "space-between", px: 2, pb: 2 }}>
                    {movie.link ? (
                      <Button size="small" href={movie.link} target="_blank" rel="noopener noreferrer">
                        Guarda
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Box>
                      <Tooltip title="Modifica">
                        <IconButton size="small" component={RouterLink} to={`/movies/${movie.id}`}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Elimina">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(movie)}
                          disabled={deletingId === movie.id}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </CardActions>
                </Card>
              </Grid>
            );
  };

  return (
    <ActivityLayout
      onLiveEvent={handleLiveEvent}
      leftPanel={
        <MovieStatsPanel
          stats={stats}
          activeGenres={genres}
          onToggleGenre={toggleGenre}
          onClearGenres={() => setGenres([])}
        />
      }
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
        <Typography variant="h5" component="h1">
          FILM VISTI SU DISCORD
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            component={RouterLink}
            to="/movies/new"
          >
            Aggiungi film
          </Button>
          <Button
            variant="outlined"
            startIcon={grouping ? <CircularProgress size={20} /> : <LayersIcon />}
            onClick={handleGroupSagas}
            disabled={grouping || loading}
          >
            Raggruppa saghe e durate
          </Button>
          <Button
            variant="outlined"
            startIcon={syncing ? <CircularProgress size={20} /> : <SyncIcon />}
            onClick={handleSyncForum}
            disabled={syncing || loading}
          >
            Sincronizza forum (solo report)
          </Button>
          <Button variant="outlined" startIcon={<BackupIcon />} onClick={() => setBackupOpen(true)}>
            Backup
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => reload(true)}
            disabled={refreshing || loading}
          >
            Aggiorna
          </Button>
        </Stack>
      </Stack>

      <Box mb={3}>
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Cerca qui un film (titolo o note)..." />
      </Box>

      <Grid container spacing={2} mb={3}>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <TextField
            select
            label="Stato"
            value={status}
            onChange={(e) => setStatus(e.target.value as MovieStatus | "")}
            fullWidth
            size="small"
          >
            <MenuItem value="">Tutti</MenuItem>
            <MenuItem value="visto">Visto</MenuItem>
            <MenuItem value="da_guardare">Da guardare</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <TextField
            select
            label="Piattaforma"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            fullWidth
            size="small"
          >
            <MenuItem value="">Tutte</MenuItem>
            {withSelected(filterOptions.platforms, platform).map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <TextField
            select
            label="Genere"
            value={genres}
            onChange={(e) => {
              const value = e.target.value as unknown;
              setGenres(typeof value === "string" ? value.split(",") : (value as string[]));
            }}
            slotProps={{
              select: {
                multiple: true,
                renderValue: (selected) => (selected as string[]).join(", "),
              },
            }}
            helperText={genres.length > 1 ? "Film che hanno tutti i generi scelti" : undefined}
            fullWidth
            size="small"
          >
            {[...filterOptions.genres, ...genres.filter((x) => !filterOptions.genres.includes(x))].map((g) => (
              <MenuItem key={g} value={g}>
                <Checkbox size="small" checked={genres.includes(g)} />
                {g}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, xl: 3 }}>
          <TextField
            select
            label="Ordina per"
            value={sort}
            onChange={(e) => setSort(e.target.value as MovieSort)}
            fullWidth
            size="small"
            helperText={sort === "incompleti" ? "Prima i film con meno dati compilati" : undefined}
          >
            <MenuItem value="recenti">Più recenti (saghe raggruppate)</MenuItem>
            <MenuItem value="incompleti">Meno dati compilati</MenuItem>
            <MenuItem value="titolo">Titolo (A-Z)</MenuItem>
            <MenuItem value="genere">Genere</MenuItem>
          </TextField>
        </Grid>
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {groupingNote && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setGroupingNote(null)}>
          {groupingNote}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : movies.length === 0 ? (
        <Typography color="text.secondary" align="center" py={6}>
          Nessun film trovato con i filtri correnti.
        </Typography>
      ) : (
        <Stack spacing={3}>
          {(sort === "recenti" ? buildBlocks(movies) : ([{ kind: "plain", movies }] as MovieBlock[])).map((block, index) =>
            block.kind === "saga" ? (
              <Paper
                key={`saga-${block.name}-${index}`}
                variant="outlined"
                sx={{ p: 2.5, borderWidth: 2, borderColor: "primary.main" }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                  <LayersIcon color="primary" sx={{ fontSize: 32 }} />
                  <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
                    {block.name}
                  </Typography>
                  <Chip color="primary" label={`${block.movies[0].collection_size} film`} />
                  <Chip
                    variant="outlined"
                    color={block.movies[0].collection_seen === block.movies[0].collection_size ? "success" : "default"}
                    label={`${block.movies[0].collection_seen} di ${block.movies[0].collection_size} visti`}
                  />
                </Stack>
                <Grid container spacing={2}>
                  {block.movies.map(renderMovieCard)}
                </Grid>
              </Paper>
            ) : (
              <Grid container spacing={2} key={`plain-${index}`}>
                {block.movies.map(renderMovieCard)}
              </Grid>
            )
          )}
        </Stack>
      )}

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mt={3}
        flexWrap="wrap"
        gap={1}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {total} film{search ? " (filtrati)" : ""}
          </Typography>
          <TextField
            select
            label="Per pagina"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            size="small"
            variant="standard"
            sx={{ minWidth: 90 }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {totalPages > 1 && (
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, value) => setPage(value)}
            color="primary"
            size="small"
          />
        )}
      </Stack>

      <MovieDialog movie={selectedMovie} onClose={() => setSelectedMovie(null)} />
      <ForumReportDialog report={forumReport} onClose={() => setForumReport(null)} />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} onRestored={() => reload(true)} />
    </ActivityLayout>
  );
}
