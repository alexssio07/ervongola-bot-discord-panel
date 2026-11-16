import { Alert, Box, Button, CircularProgress } from "@mui/material";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type Area } from "../context/AuthContext";

interface Props {
  children: ReactNode;
  /** Area richiesta: senza almeno `level` su di essa la pagina non si apre. */
  area?: Area;
  level?: "read" | "write";
  /** Pagina riservata all'admin. */
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, area, level = "read", adminOnly = false }: Props) {
  const { isAuthenticated, isLoading, can, isAdmin, profileError, reloadProfile } = useAuth();

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (profileError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={reloadProfile}>
            Riprova
          </Button>
        }
      >
        {profileError}
      </Alert>
    );
  }

  if (adminOnly && !isAdmin) {
    return <Alert severity="warning">Questa sezione è riservata all'amministratore.</Alert>;
  }

  if (area && !can(area, level)) {
    return (
      <Alert severity="warning">
        {level === "write"
          ? "Non hai il permesso di modificare questa sezione. Chiedi all'amministratore."
          : "Non hai accesso a questa sezione. Chiedi all'amministratore."}
      </Alert>
    );
  }

  return <>{children}</>;
}
