import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, MUTATION_EVENT } from "../api/client";

export interface ActivityEvent {
  boot: string;
  id: number;
  timestamp: string;
  user: string;
  action: "add" | "update" | "delete";
  scope: string;
  text: string;
  old_text: string;
  /** true per gli eventi dello storico caricati all'apertura: non sono "nuovi" */
  replay: boolean;
}

export type ActivityConnection = "connecting" | "live" | "error";

const MAX_EVENTS = 200;
/** Minimo fra due aggiornamenti causati dal solo ritorno sulla scheda. */
const MIN_FOCUS_REFRESH_MS = 30_000;

/**
 * Feed delle attività. Niente connessione continua né polling a tempo (su Vercel
 * ogni lettura dello archivio e' un'operazione contata dal piano gratuito): il feed
 * si aggiorna all'apertura, quando si torna sulla scheda e subito dopo ogni modifica
 * fatta da questo browser. `onLiveEvent` viene chiamato SOLO per gli eventi comparsi
 * dopo il primo caricamento (non per lo storico), cosi' le pagine possono aggiornarsi
 * da sole senza ricaricare tutto all'apertura.
 */
export function useActivityStream(onLiveEvent?: (event: ActivityEvent) => void) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connection, setConnection] = useState<ActivityConnection>("connecting");
  const lastId = useRef(0);
  const loadedOnce = useRef(false);
  const lastFetchAt = useRef(0);
  const inFlight = useRef(false);
  const callbackRef = useRef(onLiveEvent);
  callbackRef.current = onLiveEvent;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastFetchAt.current = Date.now();
    try {
      const res = await apiClient.get<{ events: ActivityEvent[] }>("/api/activity", {
        params: { since: lastId.current },
      });
      const fresh = res.data.events.filter((e) => e.id > lastId.current);
      const isFirstLoad = !loadedOnce.current;
      loadedOnce.current = true;
      setConnection("live");
      if (fresh.length === 0) return;

      lastId.current = Math.max(...fresh.map((e) => e.id));
      const tagged = fresh.map((e) => ({ ...e, replay: isFirstLoad }));
      setEvents((prev) => [...prev, ...tagged].slice(-MAX_EVENTS));
      if (!isFirstLoad) tagged.forEach((e) => callbackRef.current?.(e));
    } catch {
      setConnection("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetchAt.current > MIN_FOCUS_REFRESH_MS) {
        void refresh();
      }
    };
    const onMutation = () => void refresh();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(MUTATION_EVENT, onMutation);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(MUTATION_EVENT, onMutation);
    };
  }, [refresh]);

  return { events, connection };
}
