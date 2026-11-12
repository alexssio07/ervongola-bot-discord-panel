import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import StopIcon from "@mui/icons-material/Stop";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "../api/client";
import {
  addPhrase,
  deletePhrase,
  findSimilarPhrases,
  getPhrasePage,
  updatePhrase,
  type PhraseItem,
  type SimilarPhrase,
} from "../api/phrases";
import type { ActivityEvent } from "../hooks/useActivityStream";
import { usePhrasePreview } from "../hooks/usePhrasePreview";
import SearchField from "./SearchField";

// Minimo 20 elementi per pagina: non esistono opzioni più piccole.
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];
const PAGE_SIZE_KEY = "ervongola_panel_page_size";
const SEARCH_DEBOUNCE_MS = 300;

function loadPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(stored) ? stored : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function newPhrasePlaceholder(fileKey: string): string {
  return fileKey === "blasfemia" ? "Inserisci una nuova bestemmia QUI" : "Inserisci una nuova frase QUI...";
}

interface Props {
  fileKey: string;
  /** Ultimo evento live ricevuto dal feed attività (di qualsiasi utente). */
  liveEvent?: ActivityEvent | null;
}

/**
 * Editor generico per un file di frasi (frasiaddio / frasieffetto /
 * blasfemia): tabella paginata, ricerca "ogni parola" sopra la tabella,
 * sezione di inserimento in alto. Ogni azione (aggiungi/modifica/elimina) è
 * una chiamata mirata al backend, che scrive subito il JSON su disco.
 *
 * Multi-utente: il pulsante "Aggiorna" ricarica la lista; quando qualcun
 * altro modifica questo file, la lista si aggiorna da sola (a meno che si stia
 * modificando una riga: in quel caso compare un avviso, per non spostare le
 * righe sotto le mani di chi sta scrivendo).
 */
export default function PhraseEditor({ fileKey, liveEvent }: Props) {
  const preview = usePhrasePreview();

  /** Cosa dice davvero il bot: le frasi d'ingresso sono precedute dal nome dell'utente. */
  function spokenText(text: string): string {
    return fileKey === "frasieffetto" ? `Alexssìo ${text}` : text;
  }

  function previewButton(id: string, text: string) {
    const active = preview.playingId === id;
    const loading = preview.loadingId === id;
    return (
      <Tooltip title={active ? "Ferma anteprima" : "Ascolta l'anteprima"}>
        <span>
          <IconButton
            size="small"
            color="primary"
            onClick={() => void preview.toggle(id, spokenText(text.trim()))}
            disabled={!text.trim()}
            aria-label={active ? "Ferma anteprima" : "Ascolta anteprima"}
          >
            {loading ? <CircularProgress size={18} /> : active ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  const [items, setItems] = useState<PhraseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(loadPageSize);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [similar, setSimilar] = useState<SimilarPhrase[]>([]);
  const similarSeq = useRef(0);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestSeq = useRef(0);

  // Debounce della ricerca: evita una richiesta ad ogni tasto premuto.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cambiare quanti elementi mostrare riparte sempre dalla prima pagina,
  // altrimenti si potrebbe restare su una pagina che non esiste più.
  function handlePageSizeChange(value: number) {
    setPageSize(value);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(value));
    } catch {
      // storage non disponibile: la preferenza vale solo per questa sessione
    }
  }

  // `silent` = aggiornamento in background (nessuno spinner che fa sparire la tabella).
  // requestSeq scarta le risposte arrivate fuori ordine.
  const load = useCallback(
    async (silent = false) => {
      const seq = ++requestSeq.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await getPhrasePage(fileKey, page, pageSize, search);
        if (seq !== requestSeq.current) return;
        setItems(data.items);
        setTotal(data.total);
        setLastUpdate(new Date());
        setPendingUpdate(false);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(apiErrorMessage(err, "Errore nel caricamento delle frasi."));
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [fileKey, page, pageSize, search]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // Se una modifica/eliminazione svuota l'ultima pagina, torna indietro.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Aggiornamento automatico quando qualcuno cambia questo stesso file.
  const loadRef = useRef(load);
  loadRef.current = load;
  const editingRef = useRef(editingIndex);
  editingRef.current = editingIndex;
  useEffect(() => {
    if (!liveEvent || liveEvent.scope !== fileKey) return;
    if (editingRef.current !== null) setPendingUpdate(true);
    else loadRef.current(true);
  }, [liveEvent, fileKey]);

  // Mentre si scrive: dopo una breve pausa cerca frasi già presenti simili.
  // `similarSeq` scarta le risposte arrivate in ritardo per un testo vecchio.
  useEffect(() => {
    const seq = ++similarSeq.current;
    const text = newText.trim();
    if (text.length < 4) {
      setSimilar([]);
      return;
    }
    const timer = setTimeout(() => {
      findSimilarPhrases(fileKey, text)
        .then((rows) => {
          if (seq === similarSeq.current) setSimilar(rows);
        })
        .catch(() => {
          if (seq === similarSeq.current) setSimilar([]); // l'avviso è facoltativo: nessun errore a schermo
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [newText, fileKey]);

  const hasExact = similar.some((s) => s.exact);

  async function handleAdd() {
    const text = newText.trim();
    if (!text || hasExact) return;
    setAdding(true);
    setError(null);
    try {
      await addPhrase(fileKey, text);
      setNewText("");
      setSimilar([]);
      await load(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante l'inserimento."));
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: PhraseItem) {
    setEditingIndex(item.index);
    setEditingText(item.text);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  async function saveEdit(item: PhraseItem) {
    const text = editingText.trim();
    if (!text) return;
    setSavingEdit(true);
    setError(null);
    try {
      await updatePhrase(fileKey, item.index, text, item.text);
      setEditingIndex(null);
      await load(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante il salvataggio."));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(item: PhraseItem) {
    setDeletingIndex(item.index);
    setError(null);
    try {
      await deletePhrase(fileKey, item.index, item.text);
      await load(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Errore durante l'eliminazione."));
    } finally {
      setDeletingIndex(null);
    }
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            placeholder={newPhrasePlaceholder(fileKey)}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { "aria-label": "Nuovo elemento" } }}
          />
          {previewButton("new", newText)}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={adding || !newText.trim() || hasExact}
            color={similar.length > 0 && !hasExact ? "warning" : "primary"}
            sx={{ whiteSpace: "nowrap" }}
          >
            {similar.length > 0 && !hasExact ? "Aggiungi comunque" : "Aggiungi"}
          </Button>
        </Stack>
        {similar.length > 0 && (
          <Alert severity={hasExact ? "error" : "warning"} sx={{ mt: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>
              {hasExact ? "Questa frase esiste già:" : "Esistono già frasi molto simili a quella che stai scrivendo:"}
            </Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {similar.map((s) => (
                <li key={s.index}>
                  «{s.text}» <em>({Math.round(s.score * 100)}% simile)</em>
                </li>
              ))}
            </Box>
          </Alert>
        )}
      </Paper>

      <Box sx={{ mb: 3 }}>
        <SearchField
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Cerca qui (ogni parola, in qualsiasi ordine)..."
        />
      </Box>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Button
          variant="outlined"
          startIcon={refreshing ? <CircularProgress size={20} /> : <RefreshIcon />}
          onClick={() => load(true)}
          disabled={refreshing || loading}
        >
          Aggiorna
        </Button>
        {lastUpdate && (
          <Typography variant="body2" color="text.secondary">
            Ultimo aggiornamento: {lastUpdate.toLocaleTimeString("it-IT")}
          </Typography>
        )}
      </Stack>

      {pendingUpdate && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => load(true)}>
              Aggiorna ora
            </Button>
          }
        >
          Qualcun altro ha modificato questa lista. Finisci la modifica, poi aggiorna.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {preview.error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={preview.clearError}>
          {preview.error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={64}>
                #
              </TableCell>
              <TableCell>Testo</TableCell>
              <TableCell width={150} align="right">
                Azioni
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    {search ? `Nessun risultato per "${search}".` : "Nessuna frase presente."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.index} hover>
                  <TableCell>{item.index + 1}</TableCell>
                  <TableCell>
                    {editingIndex === item.index ? (
                      <TextField
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(item);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        fullWidth
                        size="small"
                        variant="standard"
                        autoFocus
                      />
                    ) : (
                      item.text
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {editingIndex === item.index ? (
                      <>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => saveEdit(item)}
                          disabled={savingEdit || !editingText.trim()}
                          aria-label="Salva"
                        >
                          <SaveIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={cancelEdit} aria-label="Annulla">
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        {previewButton(`row-${item.index}`, item.text)}
                        <IconButton size="small" onClick={() => startEdit(item)} aria-label="Modifica">
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(item)}
                          disabled={deletingIndex === item.index}
                          aria-label="Elimina"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mt={3}
        flexWrap="wrap"
        gap={2}
      >
        <Stack direction="row" spacing={3} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {total} frasi{search ? " (filtrate)" : ""}
          </Typography>
          <TextField
            select
            label="Per pagina"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
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
    </Box>
  );
}
