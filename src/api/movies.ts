import { apiClient } from "./client";

export type MovieStatus = "visto" | "da_guardare";

export interface Movie {
  id: number;
  title: string;
  link: string;
  platform: string;
  status: MovieStatus;
  cover_url: string;
  genre: string;
  notes: string;
  /** Data di visione (AAAA-MM-GG), vuota se non indicata */
  watched_at: string;
  /** Utente del pannello che ha inserito il film (automatico) */
  added_by: string;
  /** Chi ha proposto il film (libero) */
  proposed_by: string;
  /** Saga/collezione (es. "Guardiani della Galassia"), vuota se è un film singolo */
  collection: string;
  /** Anno di uscita (AAAA), usato per ordinare i film della saga */
  release_year: string;
  /** Durata in minuti, 0 se sconosciuta */
  runtime: number;
  /** Solo nell'elenco: film della saga nel catalogo / quanti già visti */
  collection_size?: number;
  collection_seen?: number;
  created_at: string;
  updated_at: string;
}

export interface MovieInput {
  title: string;
  link?: string;
  platform?: string;
  status?: MovieStatus;
  cover_url?: string;
  genre?: string;
  notes?: string;
  watched_at?: string;
  proposed_by?: string;
  collection?: string;
  release_year?: string;
  /** Durata in minuti (0 = sconosciuta) */
  runtime?: number;
  /** true = salva anche se esiste già un film con lo stesso titolo */
  force?: boolean;
}

export type MovieSort = "recenti" | "incompleti" | "titolo" | "genere";

export interface MovieFilters {
  status?: MovieStatus | "";
  platform?: string;
  genre?: string;
  search?: string;
  /** recenti (predefinito, saghe raggruppate) | incompleti | titolo | genere */
  sort?: MovieSort;
}

export interface MoviePage {
  items: Movie[];
  total: number;
  page: number;
  page_size: number;
}

export async function listMovies(
  filters: MovieFilters = {},
  page = 1,
  pageSize = 12
): Promise<MoviePage> {
  const params: Record<string, string | number> = { page, page_size: pageSize };
  if (filters.status) params.status = filters.status;
  if (filters.platform) params.platform = filters.platform;
  if (filters.genre) params.genre = filters.genre;
  if (filters.search) params.search = filters.search;
  if (filters.sort && filters.sort !== "recenti") params.sort = filters.sort;

  const res = await apiClient.get<MoviePage>("/api/movies", { params });
  return res.data;
}

export async function getMovie(id: number): Promise<Movie> {
  const res = await apiClient.get<Movie>(`/api/movies/${id}`);
  return res.data;
}

export async function createMovie(data: MovieInput): Promise<Movie> {
  const res = await apiClient.post<Movie>("/api/movies", data);
  return res.data;
}

export async function updateMovie(id: number, data: Partial<MovieInput>): Promise<Movie> {
  const res = await apiClient.put<Movie>(`/api/movies/${id}`, data);
  return res.data;
}

export async function deleteMovie(id: number): Promise<void> {
  await apiClient.delete(`/api/movies/${id}`);
}

export interface MovieLookupResult {
  tmdb_id: number;
  title: string;
  year: string;
  genre: string;
  cover_url: string;
}

/** Cerca il film su TMDB (via backend) per precompilare genere e copertina. */
export async function lookupMovie(title: string): Promise<MovieLookupResult[]> {
  const res = await apiClient.get<{ results: MovieLookupResult[] }>("/api/movies/lookup", {
    params: { title },
  });
  return res.data.results;
}

export interface MovieFilterOptions {
  genres: string[];
  platforms: string[];
  proposers: string[];
  collections: string[];
}

/** Generi e piattaforme presenti nei film, per le select dei filtri. */
export async function getMovieFilterOptions(): Promise<MovieFilterOptions> {
  const res = await apiClient.get<MovieFilterOptions>("/api/movies/filters");
  return res.data;
}

/** Saga (vuota se è un film singolo) e durata in minuti di un film TMDB. */
export async function lookupMovieDetails(tmdbId: number): Promise<{ collection: string; runtime: number }> {
  const res = await apiClient.get<{ collection: string; runtime: number }>("/api/movies/lookup/details", {
    params: { tmdb_id: tmdbId },
  });
  return res.data;
}

export interface BackfillResult {
  processed: number;
  matched: number;
  with_collection: number;
  with_runtime: number;
  skipped: string[];
  /** Film abbinati solo per somiglianza del titolo (solo durata): "titolo → trovato" */
  approximate: string[];
  /** id da cui riprendere; null = finito */
  next_after_id: number | null;
}

/** Rileva saga e anno dei film già presenti (un lotto per chiamata). */
export async function backfillCollections(afterId: number): Promise<BackfillResult> {
  const res = await apiClient.post<BackfillResult>("/api/movies/backfill-collections", { after_id: afterId });
  return res.data;
}

export interface DuplicateMovie {
  id: number;
  title: string;
  release_year: string;
  status: MovieStatus;
  platform: string;
  added_by: string;
  proposed_by: string;
  created_at: string;
}

/** Film già presenti con lo stesso titolo (e anno compatibile). */
export async function checkDuplicates(
  title: string,
  releaseYear: string,
  excludeId?: number
): Promise<DuplicateMovie[]> {
  const res = await apiClient.get<{ duplicates: DuplicateMovie[] }>("/api/movies/duplicates", {
    params: { title, release_year: releaseYear || undefined, exclude_id: excludeId },
  });
  return res.data.duplicates;
}

export interface MovieStats {
  total: number;
  seen: number;
  unseen: number;
  by_genre: { genre: string; seen: number; unseen: number; total: number }[];
  /** Minuti totali dei film visti / da guardare (quelli senza durata non sono sommati) */
  seen_minutes: number;
  unseen_minutes: number;
  seen_without_runtime: number;
  unseen_without_runtime: number;
}

export async function getMovieStats(): Promise<MovieStats> {
  const res = await apiClient.get<MovieStats>("/api/movies/stats");
  return res.data;
}

export interface ForumMatch {
  id: number;
  title: string;
  status: MovieStatus;
  /** 0-1, 1 = stesso titolo */
  score: number;
}

export interface ForumReportRow {
  /** Titolo del post nel forum */
  post: string;
  /** Titolo cercato nel catalogo (diverso dal post se contiene più capitoli: "Iron Man 1-2-3") */
  title: string;
  from_multi: boolean;
  tags: string[];
  forum_status: MovieStatus;
  kind: "uguale" | "simile" | "nuovo";
  matches: ForumMatch[];
  status_differs: boolean;
}

export interface ForumReport {
  total_threads: number;
  rows: ForumReportRow[];
  missing_in_forum: string[];
  missing_in_forum_total: number;
  /** tag del forum -> stato che gli viene attribuito */
  tags: Record<string, MovieStatus>;
}

/** Confronta il forum Discord col catalogo. Solo lettura: non importa né modifica nulla. */
export async function getForumReport(refresh: boolean): Promise<ForumReport> {
  const res = await apiClient.get<ForumReport>("/api/movies/forum-report", {
    params: { refresh: refresh ? 1 : undefined },
  });
  return res.data;
}

export interface WatchProvider {
  name: string;
  logo: string;
}

export interface MovieProviders {
  found: boolean;
  /** true = titolo identico su TMDB; false = solo molto simile */
  exact?: boolean;
  tmdb_title?: string;
  tmdb_year?: string;
  region?: string;
  /** pagina JustWatch con tutte le opzioni */
  link?: string;
  flatrate?: WatchProvider[];
  free?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

/** Su quali piattaforme di streaming si può guardare il film (dati JustWatch via TMDB). */
export async function getMovieProviders(movieId: number): Promise<MovieProviders> {
  const res = await apiClient.get<MovieProviders>(`/api/movies/${movieId}/providers`);
  return res.data;
}

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  mode: RestoreMode;
  added: number;
  skipped_duplicates: number;
  /** Primi titoli saltati perché già presenti */
  skipped_titles: string[];
  invalid_count: number;
  /** Primi elementi del file non importabili, col motivo */
  invalid: { index: number; title: string; error: string }[];
  /** Film nel catalogo dopo l'operazione */
  total: number;
  /** Solo in modalità "replace": dove è stata salvata la copia del catalogo precedente */
  safety_copy: string;
}

/** Scarica l'intero catalogo come file JSON (ripristinabile con restoreMoviesBackup). */
export async function downloadMoviesBackup(): Promise<void> {
  const res = await apiClient.get<Blob>("/api/movies/backup", { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ervongola-film-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Importa un file di backup: "merge" aggiunge i film mancanti, "replace" sostituisce il catalogo. */
export async function restoreMoviesBackup(file: File, mode: RestoreMode): Promise<RestoreResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const res = await apiClient.post<RestoreResult>("/api/movies/restore", form);
  return res.data;
}
