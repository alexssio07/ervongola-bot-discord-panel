import axios from "axios";

const TOKEN_KEY = "ervongola_panel_token";

/** Evento sulla window dopo ogni richiesta che modifica dati (POST/PUT/DELETE riuscita):
 * il feed delle attività lo usa per aggiornarsi subito, senza polling a tempo. */
export const MUTATION_EVENT = "panel-mutation";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Impostata da AuthContext: permette al client di "sloggare" l'utente
// quando una richiesta torna 401, senza che ogni chiamante debba gestirlo.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export const apiClient = axios.create({
  // In sviluppo resta vuoto: il proxy di Vite (vedi vite.config.ts) inoltra
  // /api verso il backend Flask su localhost:5000. Su Vercel frontend e backend
  // sono due progetti: imposta VITE_API_URL con l'URL del progetto backend
  // (vedi .env.example e VERCEL_DEPLOY.md).
  baseURL: import.meta.env.VITE_API_URL || "",
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const method = (response.config.method ?? "get").toLowerCase();
    if (method !== "get") window.dispatchEvent(new Event(MUTATION_EVENT));
    return response;
  },
  (error) => {
    if (error?.response?.status === 401) {
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = "Si è verificato un errore."): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error || error.message || fallback;
  }
  return fallback;
}
