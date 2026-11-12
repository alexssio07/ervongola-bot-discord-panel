import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "../api/client";
import { fetchPhraseAudio } from "../api/voice";

// Cache in memoria dei blob gia' scaricati (testo -> URL), condivisa fra tutte le
// istanze: riascoltare una frase non rifa' nessuna richiesta finche' la pagina
// resta aperta. Tetto alla dimensione per non crescere all'infinito.
const URL_CACHE_MAX = 60;
const urlCache = new Map<string, string>();

function cacheUrl(text: string, url: string) {
  urlCache.set(text, url);
  if (urlCache.size > URL_CACHE_MAX) {
    const oldest = urlCache.keys().next().value as string;
    URL.revokeObjectURL(urlCache.get(oldest) as string);
    urlCache.delete(oldest);
  }
}

/** Trasforma il messaggio d'errore di un blob (JSON) in testo leggibile. */
async function blobErrorMessage(err: unknown): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await err.response.data.text());
      if (parsed?.error) return String(parsed.error);
    } catch {
      // non era JSON: uso il messaggio generico
    }
  }
  return apiErrorMessage(err, "Impossibile riprodurre l'anteprima.");
}

/**
 * Anteprima audio delle frasi. `toggle(id, testo)` avvia la riproduzione di
 * quella frase (o la ferma se e' gia' in corso); una sola frase alla volta.
 */
export function usePhrasePreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const stop = useCallback(() => {
    seq.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
    setLoadingId(null);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(
    async (id: string, text: string) => {
      const wasPlaying = playingId === id;
      stop();
      if (wasPlaying) return;

      setError(null);
      const mySeq = seq.current;
      setLoadingId(id);
      try {
        let url = urlCache.get(text);
        if (!url) {
          url = URL.createObjectURL(await fetchPhraseAudio(text));
          cacheUrl(text, url);
        }
        if (mySeq !== seq.current) return; // nel frattempo e' partita un'altra anteprima
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (mySeq === seq.current) setPlayingId(null);
        };
        audio.onerror = () => {
          if (mySeq === seq.current) {
            setPlayingId(null);
            setError("Impossibile riprodurre l'audio.");
          }
        };
        setLoadingId(null);
        setPlayingId(id);
        await audio.play();
      } catch (err) {
        if (mySeq === seq.current) {
          setLoadingId(null);
          setPlayingId(null);
          setError(await blobErrorMessage(err));
        }
      }
    },
    [playingId, stop]
  );

  return { playingId, loadingId, error, clearError: () => setError(null), toggle, stop };
}
