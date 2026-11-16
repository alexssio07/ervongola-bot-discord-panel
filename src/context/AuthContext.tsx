import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient, apiErrorMessage, getToken, setToken, setUnauthorizedHandler } from "../api/client";

export type Area = "movies" | "phrases" | "audio";
export type Level = "none" | "read" | "write";
export type Permissions = Record<Area, Level>;

const LEVEL_ORDER: Level[] = ["none", "read", "write"];

interface Me {
  username: string;
  is_admin: boolean;
  permissions: Permissions;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  /** true durante il controllo iniziale del token salvato e il caricamento dei permessi, per evitare un flash della login page */
  isLoading: boolean;
  username: string | null;
  isAdmin: boolean;
  /** Vero se l'utente ha almeno `level` sull'area. Solo per l'interfaccia: il controllo vero e' sul backend. */
  can: (area: Area, level?: "read" | "write") => boolean;
  /** Errore (non 401) nel leggere i permessi, ad esempio backend non raggiungibile. */
  profileError: string | null;
  reloadProfile: () => void;
  login: (username: string, password: string) => Promise<void>;
  /** Registrazione aperta a tutti: il nuovo utente parte in sola lettura finche'
   * l'admin non gli assegna altri permessi (vedi auth.py sul backend). */
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Finche' c'e' un token ma i permessi non sono ancora arrivati stiamo "caricando".
  const [profileLoading, setProfileLoading] = useState(() => !!getToken());

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await apiClient.get<Me>("/api/auth/me");
      setMe(res.data);
    } catch (err) {
      // Un 401 e' gia' gestito dall'interceptor (logout); qualsiasi altro errore
      // va mostrato, non confuso con "nessun permesso".
      setMe(null);
      setProfileError(apiErrorMessage(err, "Impossibile leggere i permessi dell'utente."));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    // Nessun endpoint di verifica dedicato oltre a /me: se il token e' scaduto o non
    // valido la richiesta risponde 401 e onUnauthorized fa scattare il logout.
    if (getToken()) void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setIsAuthenticated(false);
      setMe(null);
      setProfileLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading: profileLoading,
      username: me?.username ?? null,
      isAdmin: me?.is_admin ?? false,
      can(area, level = "read") {
        const have = me?.permissions?.[area] ?? "none";
        return LEVEL_ORDER.indexOf(have) >= LEVEL_ORDER.indexOf(level);
      },
      profileError,
      reloadProfile: () => void loadProfile(),
      async login(username: string, password: string) {
        try {
          const res = await apiClient.post<{ access_token: string }>("/api/auth/login", {
            username,
            password,
          });
          setToken(res.data.access_token);
          setIsAuthenticated(true);
          await loadProfile();
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
          await loadProfile();
        } catch (err) {
          throw new Error(apiErrorMessage(err, "Registrazione non riuscita."));
        }
      },
      logout() {
        setToken(null);
        setIsAuthenticated(false);
        setMe(null);
        setProfileError(null);
      },
    }),
    [isAuthenticated, profileLoading, me, profileError, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col suo Provider, pattern standard
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
