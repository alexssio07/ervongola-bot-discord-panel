import { useEffect, useState } from "react";
import axios from "axios";
import {
    Box,
    Button,
    Container,
    IconButton,
    InputAdornment,
    TextField,
    Typography,
    Stack,
    Paper,
    Grid,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import { v4 as uuidv4 } from "uuid";

interface Props {
    fileType: "blasfemia" | "frasieffetto";
}

export default function ConfigEditorList({ fileType }: Props) {
    const [items, setItems] = useState<{ id: string; text: string }[]>([]);
    const [deletedItems, setDeletedItems] = useState<string[]>([]);
    const [addedItems, setAddedItems] = useState<{ id: string; text: string }[]>([]); // Stato per gli elementi aggiunti
    const [search, setSearch] = useState("");
    const [selectedItems, setSelectedItems] = useState<string[]>([]);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    useEffect(() => {
        // Carica la lista di frasi dal file JSON
        axios
            .get(`http://localhost:5000/api/${fileType}`)
            .then((res) => {
                const data = res.data.items;
                if (fileType === "blasfemia" && Array.isArray(data.bestemmie)) {
                    setItems(data.bestemmie.map((item: { text: string }) => ({ id: uuidv4(), text: item.text })));
                } else if (fileType === "frasieffetto" && Array.isArray(data.frasi)) {
                    setItems(data.frasi.map((item: { text: string }) => ({ id: uuidv4(), text: item.text })));
                } else {
                    console.error("Formato della risposta API non valido");
                }
            })
            .catch((err) => {
                console.error("Errore nella richiesta API:", err);
            });
    }, [fileType]);

    const updateItem = (id: string, value: string) => {
        const newItems = items.map((item) =>
            item.id === id ? { ...item, text: value } : item
        );
        setItems(newItems);
    };

    const addItem = () => {
        setAddedItems([...addedItems, { id: uuidv4(), text: "" }]); // Aggiungi l'elemento allo stato degli elementi aggiunti
    };

    const deleteItem = (id: string) => {
        const itemToDelete = items.find((item) => item.id === id);
        if (itemToDelete) {
            setDeletedItems([...deletedItems, itemToDelete.text]);
            setItems(items.filter((item) => item.id !== id));
        }
    };

    const removeFromDeletedItems = (id: string) => {
        setDeletedItems(deletedItems.filter((text) => text !== id));
        setItems(items.concat({ id: uuidv4(), text: id }));
    };

    const toggleSelectItem = (id: string) => {
        if (selectedItems.includes(id)) {
            setSelectedItems(selectedItems.filter((i) => i !== id));
        } else {
            setSelectedItems([...selectedItems, id]);
        }
    };

    const saveItems = () => {
        const payload =
            fileType === "blasfemia"
                ? { items: [...items, ...addedItems].map(({ text }) => ({ text })), deletedItems: deletedItems.map((text) => ({ text })) }
                : { items: [...items, ...addedItems].map(({ text }) => ({ text, users: [] })), deletedItems: deletedItems.map((text) => ({ text })) };

        axios
            .post(`http://localhost:5000/api/${fileType}`, payload)
            .then(() => {
                setSaveMessage("Modifiche salvate con successo!");
                setItems([...items, ...addedItems]); // Aggiungi gli elementi nuovi alla lista principale
                setAddedItems([]); // Svuota la lista degli elementi aggiunti
                setDeletedItems([]);
            })
            .catch(() => setSaveMessage("Errore durante il salvataggio"));
    };

    const filteredItems = [...items, ...addedItems].filter((item) =>
        item.text.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <Container maxWidth={false} sx={{ mt: 4, width: "100%" }}>
            <Box
                sx={{
                    mb: 3,
                    display: "flex",
                    justifyContent: "space-between",
                }}
            >
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={addItem}
                    color="success"
                >
                    Aggiungi
                </Button>
                <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={saveItems}
                    color="primary"
                >
                    Salva modifiche
                </Button>
            </Box>

            <TextField
                fullWidth
                label="Cerca..."
                variant="outlined"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ mb: 3 }}
            />

            <Stack spacing={2}>
                {filteredItems.map((item) => (
                    <Paper
                        key={item.id}
                        elevation={2}
                        sx={{
                            p: 2,
                            display: "flex",
                            alignItems: "center",
                            width: "100%",
                            backgroundColor: selectedItems.includes(item.id) ? "#f0f0f0" : "white",
                            cursor: "pointer",
                        }}
                        onClick={() => toggleSelectItem(item.id)}
                    >
                        <TextField
                            fullWidth
                            variant="standard"
                            value={item.text}
                            onChange={(e) => updateItem(item.id, e.target.value)}
                            sx={{ mr: 2 }}
                        />
                        <IconButton color="error" onClick={() => deleteItem(item.id)}>
                            <DeleteIcon />
                        </IconButton>
                    </Paper>
                ))}
            </Stack>

            {deletedItems.length > 0 && (
                <Box sx={{ mt: 4 }}>
                    <Typography variant="h6" color="error">
                        Elementi eliminati:
                    </Typography>
                    <Stack spacing={1}>
                        {deletedItems.map((item, index) => (
                            <>
                                <Paper key={index} elevation={2} sx={{ p: 2 }}>
                                    <Typography>{item}</Typography>
                                </Paper>
                                <IconButton color="error" onClick={() => removeFromDeletedItems(item)}>
                                    <DeleteIcon />
                                </IconButton>
                            </>
                        ))}
                    </Stack>

                </Box>
            )}

            {saveMessage && (
                <Box sx={{ mt: 4 }}>
                    <Typography variant="body1" color="primary">
                        {saveMessage}
                    </Typography>
                </Box>
            )}
        </Container>
    );
}
