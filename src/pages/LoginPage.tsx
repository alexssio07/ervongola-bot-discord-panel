import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type Mode = "login" | "register";

export default function LoginPage() {
  const { isAuthenticated, login, register } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={redirectTo} replace />;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirmPassword) {
      setError("Le due password non coincidono.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore imprevisto.");
    } finally {
      setSubmitting(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      px={2}
    >
      <Paper
        component="form"
        onSubmit={handleSubmit}
        elevation={3}
        sx={{
          p: { xs: 3, sm: 6 },
          width: "100%",
          maxWidth: 520,
        }}
      >
        <Box display="flex" justifyContent="center" mb={3}>
          <Box
            component="img"
            src="/bot.jpg"
            alt="Er Vongola"
            sx={{
              width: 180,
              height: 180,
              borderRadius: "50%",
              objectFit: "cover",
              border: 4,
              borderColor: "primary.main",
              boxShadow: 6,
            }}
          />
        </Box>
        <Typography variant="h5" component="h1" align="center" gutterBottom>
          Er Vongola — Pannello
        </Typography>
        <Typography variant="body2" color="text.secondary" align="center" mb={3}>
          {isRegister ? "Crea un nuovo account per accedere al pannello." : "Accedi con le tue credenziali."}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          fullWidth
          required
          autoFocus
          margin="normal"
          autoComplete="username"
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          required
          margin="normal"
          autoComplete={isRegister ? "new-password" : "current-password"}
        />
        {isRegister && (
          <TextField
            label="Conferma password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
            required
            margin="normal"
            autoComplete="new-password"
          />
        )}

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 3 }}>
          <Button
            type={isRegister ? "button" : "submit"}
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            disabled={submitting}
            onClick={isRegister ? () => switchMode("login") : undefined}
            sx={{ fontWeight: 700 }}
          >
            {submitting && !isRegister ? "Accesso in corso..." : "Accedi"}
          </Button>
          <Button
            type={isRegister ? "submit" : "button"}
            variant="contained"
            color="secondary"
            fullWidth
            size="large"
            disabled={submitting}
            onClick={isRegister ? undefined : () => switchMode("register")}
            sx={{ fontWeight: 700 }}
          >
            {submitting && isRegister ? "Registrazione in corso..." : "Registrati"}
          </Button>
        </Stack>
        <Typography variant="body1" color="text.secondary" align="center" sx={{ mt: 2 }}>
          {isRegister
            ? "Compila i campi e premi Registrati per creare l'account."
            : "Non hai un account? Premi Registrati."}
        </Typography>
      </Paper>
    </Box>
  );
}
