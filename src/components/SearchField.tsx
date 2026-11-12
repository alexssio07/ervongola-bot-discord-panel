import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, TextField } from "@mui/material";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** Campo di ricerca volutamente molto evidente: grande, bordo spesso nel
 * colore primario, ombra, icona lente e pulsante per svuotarlo. */
export default function SearchField({ value, onChange, placeholder }: Props) {
  return (
    <TextField
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      sx={{
        bgcolor: "background.paper",
        borderRadius: 2,
        boxShadow: 4,
        "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
          "& fieldset": { borderWidth: 3, borderColor: "primary.main" },
          "&:hover fieldset": { borderColor: "primary.main" },
          "&.Mui-focused fieldset": { borderWidth: 4, borderColor: "primary.main" },
        },
        "& .MuiOutlinedInput-input": { py: 1.5 },
      }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon color="primary" sx={{ fontSize: 28 }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton aria-label="Svuota ricerca" onClick={() => onChange("")} edge="end">
                <ClearIcon />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
    />
  );
}
