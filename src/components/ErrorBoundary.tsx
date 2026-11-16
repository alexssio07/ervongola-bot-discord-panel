import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Quando cambia (es. il percorso), l'errore viene azzerato e la pagina riprova a mostrarsi. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/** Evita la pagina bianca: se un componente va in errore mostra un messaggio e un pulsante per ricaricare. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Errore nella pagina:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box sx={{ maxWidth: 640, mx: "auto", mt: 6 }}>
        <Stack spacing={2}>
          <Typography variant="h5" component="h1">
            Qualcosa è andato storto
          </Typography>
          <Alert severity="error">{this.state.error.message || "Errore imprevisto."}</Alert>
          <Typography variant="body2" color="text.secondary">
            Se succede dopo un aggiornamento, di solito il pannello sta ricevendo dal backend dati diversi da quelli
            attesi: controlla che l&apos;indirizzo del backend (VITE_API_URL) sia corretto.
          </Typography>
          <Box>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Ricarica la pagina
            </Button>
          </Box>
        </Stack>
      </Box>
    );
  }
}
