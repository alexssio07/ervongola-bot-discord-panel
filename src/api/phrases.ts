import { apiClient } from "./client";

export interface PhraseFileInfo {
  key: string;
  label: string;
}

export interface PhraseItem {
  index: number;
  text: string;
}

export interface PhrasePage {
  file_key: string;
  total: number;
  page: number;
  page_size: number;
  items: PhraseItem[];
}

export async function listPhraseFiles(): Promise<PhraseFileInfo[]> {
  const res = await apiClient.get<PhraseFileInfo[]>("/api/phrases/files");
  return res.data;
}

export async function getPhrasePage(
  fileKey: string,
  page: number,
  pageSize: number,
  search: string
): Promise<PhrasePage> {
  const res = await apiClient.get<PhrasePage>(`/api/phrases/${fileKey}`, {
    params: { page, page_size: pageSize, search: search || undefined },
  });
  return res.data;
}

export async function addPhrase(fileKey: string, text: string): Promise<{ index: number }> {
  const res = await apiClient.post<{ index: number }>(`/api/phrases/${fileKey}`, { text });
  return res.data;
}

/** `expectedText` è il testo che l'utente vede: il backend rifiuta l'azione se
 * nel frattempo qualcun altro ha spostato/modificato quella riga. */
export async function updatePhrase(
  fileKey: string,
  index: number,
  text: string,
  expectedText: string
): Promise<void> {
  await apiClient.put(`/api/phrases/${fileKey}/${index}`, { text, expected_text: expectedText });
}

export async function deletePhrase(fileKey: string, index: number, expectedText: string): Promise<void> {
  await apiClient.delete(`/api/phrases/${fileKey}/${index}`, { params: { expected: expectedText } });
}

export interface SimilarPhrase {
  index: number;
  text: string;
  /** 0-1, 1 = identica (ignorando maiuscole e punteggiatura) */
  score: number;
  exact: boolean;
}

/** Frasi già presenti molto simili a `text`, per avvisare prima di aggiungere. */
export async function findSimilarPhrases(fileKey: string, text: string): Promise<SimilarPhrase[]> {
  const res = await apiClient.get<{ similar: SimilarPhrase[] }>(`/api/phrases/${fileKey}/similar`, {
    params: { text },
  });
  return res.data.similar;
}

export type PhrasesRestoreMode = "merge" | "replace";

export interface PhrasesRestoreFileResult {
  label: string;
  added: number;
  duplicates: number;
  invalid_count: number;
  invalid: { index: number; error: string }[];
  /** Frasi nel file dopo l'operazione */
  total: number;
  /** Solo in modalità "replace": dove è stata salvata la copia della lista precedente */
  safety_copy: string;
}

export interface PhrasesRestoreResult {
  mode: PhrasesRestoreMode;
  added: number;
  files: Record<string, PhrasesRestoreFileResult>;
}

/** Scarica tutti i file di frasi in un unico JSON (ripristinabile con restorePhrasesBackup). */
export async function downloadPhrasesBackup(): Promise<void> {
  const res = await apiClient.get<Blob>("/api/phrases/backup", { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ervongola-frasi-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** "merge" aggiunge le frasi mancanti, "replace" sostituisce le liste presenti nel file. */
export async function restorePhrasesBackup(file: File, mode: PhrasesRestoreMode): Promise<PhrasesRestoreResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const res = await apiClient.post<PhrasesRestoreResult>("/api/phrases/restore", form);
  return res.data;
}
