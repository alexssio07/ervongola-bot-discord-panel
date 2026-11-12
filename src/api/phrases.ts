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
