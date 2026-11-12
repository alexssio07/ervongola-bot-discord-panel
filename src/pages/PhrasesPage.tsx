import { Alert, Box, CircularProgress, Tab, Tabs, Typography } from "@mui/material";
import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { apiErrorMessage } from "../api/client";
import { listPhraseFiles, type PhraseFileInfo } from "../api/phrases";
import ActivityLayout from "../components/ActivityFeed";
import PhraseEditor from "../components/PhraseEditor";
import type { ActivityEvent } from "../hooks/useActivityStream";

/** Fallback statico se il backend non risponde: evita una pagina vuota. */
const FALLBACK_FILES: PhraseFileInfo[] = [
  { key: "frasiaddio", label: "Frasi d'addio" },
  { key: "frasieffetto", label: "Frasi d'effetto (ingresso canale)" },
  { key: "blasfemia", label: "Blasfemie" },
];

export default function PhrasesPage() {
  const [files, setFiles] = useState<PhraseFileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string>(FALLBACK_FILES[0].key);
  const [liveEvent, setLiveEvent] = useState<ActivityEvent | null>(null);

  const handleLiveEvent = useCallback((event: ActivityEvent) => setLiveEvent(event), []);

  useEffect(() => {
    listPhraseFiles()
      .then((data) => {
        setFiles(data);
        if (data.length > 0) setActiveKey(data[0].key);
      })
      .catch((err) => {
        setError(apiErrorMessage(err, "Impossibile caricare l'elenco dei file."));
        setFiles(FALLBACK_FILES);
      });
  }, []);

  function handleChange(_e: SyntheticEvent, value: string) {
    setActiveKey(value);
  }

  return (
    <ActivityLayout onLiveEvent={handleLiveEvent}>
      <Typography variant="h5" component="h1" gutterBottom>
        Modifica frasi
      </Typography>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {files === null ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Tabs
            value={activeKey}
            onChange={handleChange}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
          >
            {files.map((file) => (
              <Tab
                key={file.key}
                value={file.key}
                label={file.label}
              />
            ))}
          </Tabs>

          {/* key forza il remount dell'editor al cambio tab, così ogni file
              parte con la propria pagina/ricerca puliti invece di condividere
              lo stato del tab precedente. */}
          <PhraseEditor key={activeKey} fileKey={activeKey} liveEvent={liveEvent} />
        </>
      )}
    </ActivityLayout>
  );
}
