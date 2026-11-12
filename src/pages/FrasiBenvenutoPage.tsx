import {
    Box,
    Button,
    Card,
    CardContent,
    CardHeader,
    Pagination,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { FrasiFileModel } from "../models/frasi-file.model";
import { frasi } from "../../../json/frasieffetto.json";
import axios from "axios";

const FrasiBenvenutoPage = () => {
    const [texts, setTexts] = useState<string[]>([]);
    const [fileLoaded, setFileLoaded] = useState(false);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const pageSize = 10;
    const frasiFile = frasi;

    const filteredIndices = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return texts.map((_, i) => i);
        return texts.reduce<number[]>((acc, t, i) => {
            if (t?.toLowerCase().includes(q)) acc.push(i);
            return acc;
        }, []);
    }, [texts, search]);

    const totalPages = Math.max(1, Math.ceil(filteredIndices.length / pageSize));

    const paginatedIndices = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredIndices.slice(start, start + pageSize);
    }, [filteredIndices, page, pageSize]);

    useEffect(() => {
        setPage(1);
    }, [search, texts.length]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    useEffect(() => {
        document.title = "Editor frasi JSON – React";
    }, []);

    useEffect(() => {
        console.log(frasiFile.map((f) => f.text));
        setTexts(frasiFile.map((f) => f.text));
        setFileLoaded(true);
    }, [frasiFile]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed: FrasiFileModel = JSON.parse(String(reader.result));
                if (!parsed || !Array.isArray(parsed.frasi)) {
                    throw new Error("Struttura JSON non valida: manca 'frasi'");
                }
                const onlyTexts = parsed.frasi
                    .filter((f) => typeof f?.text === "string")
                    .map((f) => f.text);
                setTexts(onlyTexts);
                setFileLoaded(true);
            } catch (err) {
                setFileLoaded(false);
                alert("Errore nel parsing del file. Controlla il formato.");
            }
        };
        reader.readAsText(file);
    };

    const updateText = (index: number, value: string) => {
        setTexts((prev) => prev.map((t, i) => (i === index ? value : t)));
    };

    const addPhrase = () => {
        setTexts((prev) => ["", ...prev]);
    };

    const downloadJson = async () => {
        await axios.post("http://127.0.0.1:5000/api/saveFile/frasieffetto", {
            frasi: texts.map((t) => ({ text: t, users: [] })),
        });
    };

    return (
        <Box minHeight="100vh" bgcolor="background.default">
            <Box maxWidth="md" mx="auto" py={6}>
                <Card>
                    <CardHeader
                        title={
                            <Typography variant="h4" align="center">
                                Editor frasi JSON
                            </Typography>
                        }
                        subheader={
                            <Typography variant="subtitle1" align="center">
                                Carica un file JSON con la chiave <b>frasi</b>, modifica i testi e scarica il file aggiornato.
                            </Typography>
                        }
                    />
                    <CardContent>
                        <Stack spacing={4}>
                            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
                                {/* <Button variant="contained" component="label">
                                    Carica file JSON
                                    <input
                                        type="file"
                                        accept=".json"
                                        hidden
                                        onChange={handleFileUpload}
                                    />
                                </Button> */}
                                <TextField
                                    label="Cerca nelle frasi"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    variant="outlined"
                                    size="small"
                                    sx={{ flex: 1, minWidth: 200 }}
                                    disabled={!fileLoaded}
                                />
                                <Button variant="outlined" onClick={addPhrase} disabled={!fileLoaded}>
                                    Aggiungi frase
                                </Button>
                                <Button
                                    variant="contained"
                                    color="success"
                                    onClick={downloadJson}
                                    disabled={texts.length === 0}
                                >
                                    Salva
                                </Button>
                            </Stack>

                            {fileLoaded && (
                                <Box>
                                    {texts.length === 0 ? (
                                        <Typography color="text.secondary" align="center">
                                            Nessuna frase trovata. Usa "Aggiungi frase" per crearne una.
                                        </Typography>
                                    ) : filteredIndices.length === 0 ? (
                                        <Typography color="text.secondary" align="center">
                                            Nessun risultato per "{search}". Prova con un'altra parola o cancella il filtro.
                                        </Typography>
                                    ) : (
                                        <>
                                            <Stack spacing={2}>
                                                {paginatedIndices.map((originalIndex) => (
                                                    <Box key={originalIndex} p={2} borderRadius={2} boxShadow={1} bgcolor="background.paper">
                                                        <Typography variant="caption" color="text.secondary">
                                                            Frase {originalIndex + 1}
                                                        </Typography>
                                                        <TextField
                                                            fullWidth
                                                            value={texts[originalIndex]}
                                                            placeholder="Inserisci il testo della frase"
                                                            onChange={(e) => updateText(originalIndex, e.target.value)}
                                                            variant="standard"
                                                            sx={{ mt: 1 }}
                                                        />
                                                    </Box>
                                                ))}
                                            </Stack>
                                            {totalPages > 1 && (
                                                <Pagination
                                                    count={totalPages}
                                                    page={page}
                                                    onChange={(_, value) => setPage(value)}
                                                    color="primary"
                                                    showFirstButton
                                                    showLastButton
                                                    sx={{ display: "flex", justifyContent: "center", mt: 3 }}
                                                />
                                            )}
                                            {filteredIndices.length > 0 && filteredIndices.length < texts.length && (
                                                <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
                                                    Mostrando {filteredIndices.length} di {texts.length} frasi
                                                </Typography>
                                            )}
                                        </>
                                    )}
                                </Box>
                            )}
                        </Stack>
                    </CardContent>
                </Card>
            </Box>
        </Box>
    );
};

export default FrasiBenvenutoPage;