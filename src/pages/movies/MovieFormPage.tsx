import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { apiErrorMessage } from "../../api/client";
import {
  checkDuplicates,
  createMovie,
  getMovie,
  getMovieFilterOptions,
  lookupMovie,
  lookupMovieDetails,
  updateMovie,
  type DuplicateMovie,
  type MovieInput,
  type MovieLookupResult,
  type MovieStatus,
} from "../../api/movies";

const LOOKUP_DEBOUNCE_MS = 700;
const LOOKUP_MIN_CHARS = 3;
const DUPLICATE_DEBOUNCE_MS = 500;

function formatAddedDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { dateStyle: "long" });
}

const EMPTY_FORM: MovieInput = {
  title: "",
  link: "",
  platform: "",
  status: "da_guardare",
  cover_url: "",
  genre: "",
  notes: "",
  watched_at: "",
  proposed_by: "",
  collection: "",
  release_year: "",
  runtime: 0,
};

export default function MovieFormPage() {
  const params = useParams<{ id: string }>();
  const isEditing = params.id !== undefined && params.id !== "new";
  const navigate = useNavigate();

  const [form, setForm] = useState<MovieInput>(EMPTY_FORM);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nomi già usati in "Proposto da": suggerimenti, ma si può scrivere qualsiasi nome.
  const [proposers, setProposers] = useState<string[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  useEffect(() => {
    getMovieFilterOptions()
      .then((options) => {
        setProposers(options.proposers ?? []);
        setCollections(options.collections ?? []);
      })
      .catch(() => {
        // senza suggerimenti il campo resta un normale testo libero
      });
  }, []);

  // Ricerca automatica del genere (TMDB) mentre si scrive il titolo.
  const [lookupResults, setLookupResults] = useState<MovieLookupResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [selectedTmdbId, setSelectedTmdbId] = useState<number | null>(null);
  // Ultimi valori inseriti automaticamente: finché il campo coincide con
  // questi (o è vuoto) possiamo sostituirli; se l'utente li ha scritti/modificati
  // a mano non vengono mai toccati.
  const autoFilled = useRef({ genre: "", cover: "", collection: "", year: "", runtime: 0 });
  const detailSeq = useRef(0);
  const lookupSeq = useRef(0);
  // Quando si sceglie un suggerimento il titolo viene sostituito con quello
  // completo: la ricerca che ne seguirebbe non deve rimpiazzare la scelta.
  const suppressLookupTitle = useRef<string | null>(null);
  // In modifica la ricerca parte solo dopo che l'utente tocca il titolo,
  // non appena la pagina carica i dati del film.
  const titleTouched = useRef(false);
  const [coverFailed, setCoverFailed] = useState(false);

  // Avviso "film già presente"
  const [duplicates, setDuplicates] = useState<DuplicateMovie[]>([]);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    const id = Number(params.id);
    setLoading(true);
    getMovie(id)
      .then((movie) => {
        setForm({
          title: movie.title,
          link: movie.link,
          platform: movie.platform,
          status: movie.status,
          cover_url: movie.cover_url,
          genre: movie.genre,
          notes: movie.notes,
          watched_at: movie.watched_at ?? "",
          proposed_by: movie.proposed_by ?? "",
          collection: movie.collection ?? "",
          release_year: movie.release_year ?? "",
          runtime: movie.runtime ?? 0,
        });
      })
      .catch((err) => setError(apiErrorMessage(err, "Impossibile caricare il film.")))
      .finally(() => setLoading(false));
  }, [isEditing, params.id]);

  function setField<K extends keyof MovieInput>(field: K, value: MovieInput[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function todayLocalIso(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Passando a "Visto" senza una data già indicata, propone la data di oggi
  // (modificabile o cancellabile).
  function handleStatusChange(status: MovieStatus) {
    setForm((prev) => ({
      ...prev,
      status,
      watched_at: status === "visto" && !prev.watched_at ? todayLocalIso() : prev.watched_at,
    }));
  }

  // overwrite = true quando l'utente sceglie esplicitamente un suggerimento:
  // in quel caso i dati di quel film sostituiscono quelli già presenti.
  function applyLookup(result: MovieLookupResult, overwrite = false) {
    setSelectedTmdbId(result.tmdb_id);
    setForm((prev) => {
      const next = { ...prev };
      if (result.genre && (overwrite || !prev.genre || prev.genre === autoFilled.current.genre)) {
        next.genre = result.genre;
        autoFilled.current.genre = result.genre;
      }
      if (result.cover_url && (overwrite || !prev.cover_url || prev.cover_url === autoFilled.current.cover)) {
        next.cover_url = result.cover_url;
        autoFilled.current.cover = result.cover_url;
      }
      if (result.year && (overwrite || !prev.release_year || prev.release_year === autoFilled.current.year)) {
        next.release_year = result.year;
        autoFilled.current.year = result.year;
      }
      return next;
    });

    // Saga e durata non sono nei risultati di ricerca: serve la scheda dettagliata del film.
    const seq = ++detailSeq.current;
    lookupMovieDetails(result.tmdb_id)
      .then(({ collection, runtime }) => {
        if (seq !== detailSeq.current) return; // l'utente ha già scelto un altro risultato
        setForm((prev) => {
          const next = { ...prev };
          if (overwrite || !prev.collection || prev.collection === autoFilled.current.collection) {
            next.collection = collection;
            autoFilled.current.collection = collection;
          }
          if (runtime && (overwrite || !prev.runtime || prev.runtime === autoFilled.current.runtime)) {
            next.runtime = runtime;
            autoFilled.current.runtime = runtime;
          }
          return next;
        });
      })
      .catch(() => {
        // senza la saga il film resta singolo: si può impostare a mano
      });
  }

  // Debounce: la ricerca parte solo quando si smette di scrivere. In modifica
  // i campi già compilati non vengono mai sovrascritti (solo quelli vuoti).
  useEffect(() => {
    if (isEditing && !titleTouched.current) return;
    const title = (form.title ?? "").trim();
    if (suppressLookupTitle.current !== null) {
      const suppressed = suppressLookupTitle.current;
      suppressLookupTitle.current = null;
      if (title === suppressed) {
        lookupSeq.current++; // scarta eventuali ricerche ancora in corso
        return; // titolo appena scelto dai suggerimenti
      }
    }
    if (title.length < LOOKUP_MIN_CHARS) {
      setLookupResults([]);
      setLookupNote(null);
      setLookupLoading(false);
      return;
    }
    const seq = ++lookupSeq.current;
    const timer = setTimeout(async () => {
      setLookupLoading(true);
      try {
        const results = await lookupMovie(title);
        if (seq !== lookupSeq.current) return; // risposta di una ricerca superata
        setLookupResults(results);
        if (results.length > 0) {
          setLookupNote(null);
          applyLookup(results[0]);
        } else {
          setSelectedTmdbId(null);
          setLookupNote("Nessun film trovato online: inserisci il genere a mano.");
        }
      } catch (err) {
        if (seq !== lookupSeq.current) return;
        setLookupResults([]);
        const code = axios.isAxiosError(err) ? err.response?.data?.code : undefined;
        setLookupNote(
          code === "no_key"
            ? "Ricerca automatica non attiva (manca la chiave TMDB sul server): inserisci il genere a mano."
            : apiErrorMessage(err, "Ricerca del genere non riuscita: inserisci il genere a mano.")
        );
      } finally {
        if (seq === lookupSeq.current) setLookupLoading(false);
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // applyLookup usa solo ref e setState funzionali: non serve come dipendenza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, isEditing]);

  // Scelta di un suggerimento: scrive il titolo completo e applica i suoi dati.
  function handlePickSuggestion(result: MovieLookupResult) {
    suppressLookupTitle.current = result.title.trim();
    titleTouched.current = true;
    setField("title", result.title);
    applyLookup(result, true);
  }

  // La copertina può cambiare (nuovo suggerimento, URL scritto a mano): si riprova a caricarla.
  useEffect(() => {
    setCoverFailed(false);
  }, [form.cover_url]);

  // Avviso in tempo reale se il film esiste già (stesso titolo, anno compatibile).
  useEffect(() => {
    const title = (form.title ?? "").trim();
    if (title.length < 2 || loading) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkDuplicates(title, form.release_year ?? "", isEditing ? Number(params.id) : undefined)
        .then((found) => {
          if (!cancelled) setDuplicates(found);
        })
        .catch(() => {
          if (!cancelled) setDuplicates([]); // l'avviso è un aiuto: se fallisce non blocca nulla
        });
    }, DUPLICATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.title, form.release_year, isEditing, params.id, loading]);

  async function save(force: boolean) {
    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
        await updateMovie(Number(params.id), form);
      } else {
        await createMovie({ ...form, force });
      }
      navigate("/movies");
    } catch (err) {
      // 409: qualcuno ha inserito lo stesso film nel frattempo (o l'avviso live non è arrivato in tempo).
      if (axios.isAxiosError(err) && err.response?.status === 409 && err.response.data?.code === "duplicate") {
        setDuplicates(err.response.data.duplicates ?? []);
        setConfirmDuplicateOpen(true);
      } else {
        setError(apiErrorMessage(err, "Errore durante il salvataggio."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title?.trim()) {
      setError("Il titolo è obbligatorio.");
      return;
    }
    // Nuovo film già presente: chiede conferma prima di creare un doppione.
    if (!isEditing && duplicates.length > 0) {
      setConfirmDuplicateOpen(true);
      return;
    }
    await save(false);
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth={900} mx="auto">
      <Typography variant="h5" component="h1" gutterBottom>
        {isEditing ? "Modifica film" : "Aggiungi film"}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper component="form" onSubmit={handleSubmit} variant="outlined" sx={{ p: 3 }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField
              label="Titolo"
              value={form.title}
              onChange={(e) => {
                titleTouched.current = true;
                setField("title", e.target.value);
              }}
              required
              fullWidth
              autoFocus
              helperText="Scrivi il titolo: genere e copertina vengono cercati online in automatico."
            />

            {duplicates.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                <Typography sx={{ fontWeight: 700 }}>
                  {isEditing ? "Esiste un altro film con questo titolo." : "Attenzione: questo film è già nel catalogo."}
                </Typography>
                {duplicates.map((d) => (
                  <Typography key={d.id} variant="body2" sx={{ mt: 0.5 }}>
                    «{d.title}»{d.release_year ? ` (${d.release_year})` : ""} —{" "}
                    {d.status === "visto" ? "già visto" : "da guardare"}
                    {d.platform ? ` su ${d.platform}` : ""}
                    {d.added_by ? `, aggiunto da ${d.added_by}` : ""}
                    {formatAddedDate(d.created_at) ? ` il ${formatAddedDate(d.created_at)}` : ""}.{" "}
                    <RouterLink to={`/movies/${d.id}`}>Apri il film</RouterLink>
                  </Typography>
                ))}
              </Alert>
            )}

            {lookupResults.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {lookupResults.length > 1
                    ? "Film trovati: clicca quello giusto per usare il suo titolo completo e i suoi dati."
                    : "Film trovato:"}
                </Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {lookupResults.map((r) => {
                    const selected = r.tmdb_id === selectedTmdbId;
                    return (
                      <ButtonBase
                        key={r.tmdb_id}
                        onClick={() => handlePickSuggestion(r)}
                        aria-pressed={selected}
                        sx={{
                          display: "flex",
                          alignItems: "stretch",
                          textAlign: "left",
                          gap: 1.5,
                          p: 1,
                          width: { xs: "100%", sm: 280 },
                          borderRadius: 1,
                          border: selected ? 3 : 1,
                          borderColor: selected ? "primary.main" : "divider",
                          bgcolor: "background.paper",
                        }}
                      >
                        <Box
                          sx={{
                            width: 46,
                            height: 69,
                            flexShrink: 0,
                            borderRadius: 0.5,
                            bgcolor: "action.hover",
                            overflow: "hidden",
                          }}
                        >
                          {r.cover_url && (
                            <Box
                              component="img"
                              src={r.cover_url}
                              alt=""
                              loading="lazy"
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          )}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 700, wordBreak: "break-word" }}>
                            {r.title}
                            {r.year ? ` (${r.year})` : ""}
                          </Typography>
                          {r.genre && (
                            <Typography variant="caption" color="text.secondary">
                              {r.genre}
                            </Typography>
                          )}
                          {selected && (
                            <Typography variant="caption" color="primary" sx={{ display: "block", fontWeight: 700 }}>
                              Selezionato
                            </Typography>
                          )}
                        </Box>
                      </ButtonBase>
                    );
                  })}
                </Stack>
              </Box>
            )}
            {lookupNote && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {lookupNote}
              </Alert>
            )}
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Link dove guardarlo"
              value={form.link}
              onChange={(e) => setField("link", e.target.value)}
              fullWidth
              placeholder="https://..."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Piattaforma"
              value={form.platform}
              onChange={(e) => setField("platform", e.target.value)}
              fullWidth
              placeholder="Netflix, Prime Video, ..."
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Stato"
              value={form.status}
              onChange={(e) => handleStatusChange(e.target.value as MovieStatus)}
              fullWidth
            >
              <MenuItem value="da_guardare">Da guardare</MenuItem>
              <MenuItem value="visto">Visto</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Genere"
              value={form.genre}
              onChange={(e) => setField("genre", e.target.value)}
              fullWidth
              slotProps={{
                input: {
                  endAdornment: lookupLoading ? (
                    <InputAdornment position="end">
                      <CircularProgress size={20} />
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Data di visione"
              type="date"
              value={form.watched_at ?? ""}
              onChange={(e) => setField("watched_at", e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
          <Grid size={12}>
            <Autocomplete
              freeSolo
              options={proposers}
              inputValue={form.proposed_by ?? ""}
              onInputChange={(_e, value) => setField("proposed_by", value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Proposto da"
                  helperText="Chi ha proposto il film (facoltativo). Chi lo inserisce nel pannello viene registrato in automatico."
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Autocomplete
              freeSolo
              options={collections}
              inputValue={form.collection ?? ""}
              onInputChange={(_e, value) => setField("collection", value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Saga / collezione"
                  helperText="Es. “Guardiani della Galassia”: i film con la stessa saga vengono raggruppati. Compilata in automatico se il film fa parte di una saga."
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Anno di uscita"
              value={form.release_year ?? ""}
              onChange={(e) => setField("release_year", e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 4 } }}
              helperText="Ordina i film dentro la saga"
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Durata (minuti)"
              value={form.runtime ? String(form.runtime) : ""}
              onChange={(e) => setField("runtime", Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || 0)}
              fullWidth
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 4 } }}
              helperText="Compilata in automatico; serve per le statistiche"
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Link copertina"
              value={form.cover_url}
              onChange={(e) => setField("cover_url", e.target.value)}
              fullWidth
              placeholder="https://..."
            />
            {form.cover_url?.trim() && (
              <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mt: 1.5 }}>
                {coverFailed ? (
                  <Alert severity="warning" sx={{ flexGrow: 1 }}>
                    Non riesco a caricare l'immagine da questo link: controlla l'indirizzo.
                  </Alert>
                ) : (
                  <>
                    <Box
                      component="img"
                      src={form.cover_url.trim()}
                      alt={`Anteprima della copertina di ${form.title || "questo film"}`}
                      onError={() => setCoverFailed(true)}
                      sx={{
                        width: 140,
                        maxHeight: 210,
                        objectFit: "cover",
                        borderRadius: 1,
                        border: 1,
                        borderColor: "divider",
                        boxShadow: 3,
                      }}
                    />
                    <Box>
                      <Typography sx={{ fontWeight: 700, fontSize: "1.15rem" }}>
                        {form.title || "—"}
                        {form.release_year ? ` (${form.release_year})` : ""}
                      </Typography>
                      {form.genre && (
                        <Typography variant="body2" color="text.secondary">
                          {form.genre}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Anteprima della copertina: controlla che sia davvero il film giusto.
                      </Typography>
                    </Box>
                  </>
                )}
              </Stack>
            )}
          </Grid>
          <Grid size={12}>
            <TextField
              label="Note"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
          </Grid>
        </Grid>

        <Stack direction="row" spacing={2} justifyContent="flex-end" mt={3}>
          <Button onClick={() => navigate("/movies")} disabled={saving}>
            Annulla
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? "Salvataggio..." : "Salva"}
          </Button>
        </Stack>
      </Paper>

      <Dialog open={confirmDuplicateOpen} onClose={() => setConfirmDuplicateOpen(false)}>
        <DialogTitle>Questo film è già presente</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {duplicates.map((d) => (
              <Typography key={d.id} sx={{ mb: 1 }}>
                «{d.title}»{d.release_year ? ` (${d.release_year})` : ""}
                {d.added_by ? ` — aggiunto da ${d.added_by}` : ""}
                {formatAddedDate(d.created_at) ? ` il ${formatAddedDate(d.created_at)}` : ""}.
              </Typography>
            ))}
            <Typography>Vuoi aggiungerlo comunque come film separato?</Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDuplicateOpen(false)} autoFocus>
            Annulla
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setConfirmDuplicateOpen(false);
              save(true);
            }}
          >
            Aggiungi comunque
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
