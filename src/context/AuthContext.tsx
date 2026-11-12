import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient, apiErrorMessage, getToken, setToken, setUnauthorizedHandler } from "../api/client";

interface AuthContextValue {
  isAuthenticated: boolean;
  /** true durante il controllo iniziale del token salvato, per evitare un flash della login page */
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  /** Registrazione volontariamente aperta a chiunque (nessun invito/codice
   * richiesto) — scelta esplicita, vedi l'avviso in auth.py sul backend. */
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Nessun endpoint di verifica dedicato: la presenza di un token salvato
    // è sufficiente per mostrare l'app; se il token è scaduto/non valido,
    // la prima richiesta autenticata risponderà 401 e onUnauthorized farà
    // scattare il logout automatico (vedi sotto).
    setIsAuthenticated(!!getToken());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setIsAuthenticated(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading,
      async login(username: string, password: string) {
        try {
          const res = await apiClient.post<{ access_token: string }>("/api/auth/login", {
            username,
            password,
          });
          setToken(res.data.access_token);
          setIsAuthenticated(true);
        } catch (err) {
          throw new Error(apiErrorMessage(err, "Credenziali non valide."));
        }
      },
      async register(username: string, password: string) {
        try {
          const res = await apiClient.post<{ access_token: string }>("/api/auth/register", {
            username,
            password,
          });
          // Login automatico dopo la registrazione: evita di far reinserire
          // le stesse credenziali appena scelte.
          setToken(res.data.access_token);
          setIsAuthenticated(true);
        } catch (err) {
          throw new Error(apiErrorMessage(err, "Registrazione non riuscita."));
        }
      },
      logout() {
        setToken(null);
        setIsAuthenticated(false);
      },
    }),
    [isAuthenticated, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col suo Provider, pattern standard
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
