import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import {
  AREA_LABELS,
  LEVEL_LABELS,
  deleteUser,
  listUsers,
  updateUserPermissions,
  type AdminUser,
} from "../api/admin";
import { apiErrorMessage } from "../api/client";
import type { Area, Level } from "../context/AuthContext";

const AREAS = Object.keys(AREA_LABELS) as Area[];
const LEVELS = Object.keys(LEVEL_LABELS) as Level[];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("it-IT");
}

/** Pannello riservato all'admin: permessi di lettura/scrittura per ogni sezione. */
export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(apiErrorMessage(err, "Impossibile caricare gli utenti."));
      setUsers((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleChange(user: AdminUser, area: Area, level: Level) {
    if (user.permissions[area] === level) return;
    const next = { ...user.permissions, [area]: level };
    setBusyId(user.id);
    try {
      const saved = await updateUserPermissions(user.id, next);
      setUsers((current) => current?.map((u) => (u.id === saved.id ? saved : u)) ?? null);
      setNotice(`Permessi di ${user.username} aggiornati.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Salvataggio non riuscito."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!window.confirm(`Eliminare l'utente "${user.username}"? Perderà subito l'accesso.`)) return;
    setBusyId(user.id);
    try {
      await deleteUser(user.id);
      setUsers((current) => current?.filter((u) => u.id !== user.id) ?? null);
      setNotice(`Utente ${user.username} eliminato.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Eliminazione non riuscita."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h5" component="h1">
          Utenti e permessi
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void load()}>
          Aggiorna
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Chi si registra parte in sola lettura. «Scrittura» include la lettura; «Nessuno» nasconde la sezione.
        L'amministratore (variabili d'ambiente) ha sempre accesso completo e non compare nell'elenco.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {users === null ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : users.length === 0 ? (
        <Typography color="text.secondary">Nessun utente registrato.</Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Utente</TableCell>
                <TableCell>Registrato il</TableCell>
                {AREAS.map((area) => (
                  <TableCell key={area}>{AREA_LABELS[area]}</TableCell>
                ))}
                <TableCell align="right">Azioni</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{user.username}</TableCell>
                  <TableCell>{formatDate(user.created_at)}</TableCell>
                  {AREAS.map((area) => (
                    <TableCell key={area}>
                      <Select
                        size="small"
                        value={user.permissions[area]}
                        disabled={busyId === user.id}
                        onChange={(e) => void handleChange(user, area, e.target.value as Level)}
                        inputProps={{ "aria-label": `${AREA_LABELS[area]} di ${user.username}` }}
                        sx={{ minWidth: 120 }}
                      >
                        {LEVELS.map((level) => (
                          <MenuItem key={level} value={level}>
                            {LEVEL_LABELS[level]}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <Tooltip title="Elimina utente">
                      <span>
                        <IconButton
                          color="error"
                          disabled={busyId === user.id}
                          onClick={() => void handleDelete(user)}
                          aria-label={`Elimina ${user.username}`}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Snackbar
        open={notice !== null}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}
