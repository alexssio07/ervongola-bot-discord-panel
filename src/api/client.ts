import axios, { AxiosError, type AxiosResponse } from "axios";

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

/** Indirizzo del backend usato da questa build (vuoto = stesso dominio del sito). */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL || "";

/** Il backend risponde sempre JSON (o file): una pagina HTML significa che la richiesta e'
 * finita altrove, ad es. sul frontend stesso (VITE_API_URL mancante: la regola SPA risponde
 * 200 con index.html) o sulla pagina di login della protezione di Vercel. */
function isHtmlResponse(response?: AxiosResponse): boolean {
  return String(response?.headers?.["content-type"] ?? "").toLowerCase().includes("text/html");
}

function misconfiguredMessage(status?: number): string {
  const where = API_BASE_URL || "non impostato: le chiamate vanno allo stesso sito del pannello";
  return status === 401
    ? `L'indirizzo API risponde con una pagina di accesso di Vercel (Deployment Protection) invece che con l'API. Indirizzo API: ${where}.`
    : `Il backend non ha risposto come previsto. Controlla VITE_API_URL nel progetto frontend e rifai il deploy. Indirizzo API: ${where}.`;
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
    if (isHtmlResponse(response)) {
      return Promise.reject(
        new AxiosError(misconfiguredMessage(), "ERR_BAD_RESPONSE", response.config, response.request, response)
      );
    }
    const method = (response.config.method ?? "get").toLowerCase();
    if (method !== "get") window.dispatchEvent(new Event(MUTATION_EVENT));
    return response;
  },
  (error) => {
    if (error?.response?.status === 401) {
      if (isHtmlResponse(error.response)) {
        // 401 della protezione di Vercel, non del nostro backend: non e' una sessione scaduta.
        error.message = misconfiguredMessage(401);
      } else {
        onUnauthorized();
      }
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
