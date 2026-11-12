import { createTheme, type Theme } from "@mui/material/styles";

export type ThemeMode = "light" | "dark";
export type ThemePalette = "standard" | "daltonic";
export type FontSize = "normale" | "grande" | "molto-grande";

export interface ThemeSettings {
  mode: ThemeMode;
  palette: ThemePalette;
  highContrast: boolean;
  fontSize: FontSize;
}

export const defaultThemeSettings: ThemeSettings = {
  mode: "dark",
  palette: "standard",
  highContrast: false,
  fontSize: "normale",
};

const FONT_SIZE_PX: Record<FontSize, number> = {
  normale: 14,
  grande: 16,
  "molto-grande": 19,
};

/**
 * Palette "daltonica": basata su Okabe-Ito, una palette pensata per restare
 * distinguibile a chi ha protanopia, deuteranopia o tritanopia — non serve
 * una palette diversa per ogni tipo di daltonismo, questa funziona per
 * tutti insieme. Sostituisce la vecchia daltonicTheme (che era solo un tema
 * scuro con arancio/ciano scelti ad occhio, senza un criterio sistematico).
 */
function buildPalette(settings: ThemeSettings) {
  const { mode, palette, highContrast } = settings;

  if (palette === "daltonic") {
    return {
      mode,
      primary: { main: mode === "dark" ? "#56B4E9" : "#0072B2" }, // azzurro (Okabe-Ito)
      secondary: { main: mode === "dark" ? "#E69F00" : "#D55E00" }, // arancio/vermiglio
      success: { main: "#009E73" }, // verde bluastro
      warning: { main: "#E69F00" },
      error: { main: "#D55E00" },
      background: highContrast
        ? { default: mode === "dark" ? "#000000" : "#ffffff", paper: mode === "dark" ? "#000000" : "#ffffff" }
        : { default: mode === "dark" ? "#101418" : "#f7f7f7", paper: mode === "dark" ? "#181e24" : "#ffffff" },
    };
  }

  return {
    mode,
    primary: { main: mode === "dark" ? "#8686ff" : "#5b5bf0" },
    secondary: { main: mode === "dark" ? "#4ade95" : "#0f7b4c" },
    // Fuori dall'alto contrasto NON impostiamo affatto "background": una
    // chiave "background: undefined" esplicita rompe la fusione interna dei
    // default di MUI (che si aspetta la chiave assente, non presente-ma-
    // undefined) e lascia "theme.palette.background" letteralmente
    // undefined — causa di un crash reale scoperto in produzione
    // (CssBaseline/AppBar leggono "background.default"/"background.paper").
    // Omettendo la chiave, MUI applica da solo i suoi colori di sfondo
    // predefiniti coerenti con "mode".
    ...(highContrast
      ? {
          background: {
            default: mode === "dark" ? "#000000" : "#ffffff",
            paper: mode === "dark" ? "#000000" : "#ffffff",
          },
        }
      : {}),
  };
}

export function createAppTheme(settings: ThemeSettings): Theme {
  return createTheme({
    palette: buildPalette(settings) as never,
    typography: {
      fontSize: FONT_SIZE_PX[settings.fontSize],
    },
    components: {
      // Bordi e contrasto più marcati in modalità alto contrasto: aiuta chi
      // ha bassa acuità visiva a distinguere i confini degli elementi senza
      // dover contare solo su sfumature di colore/ombra.
      MuiPaper: {
        styleOverrides: {
          root: settings.highContrast
            ? { border: "1px solid currentColor", boxShadow: "none" }
            : {},
        },
      },
      MuiButton: {
        styleOverrides: {
          root: settings.highContrast ? { border: "1px solid currentColor" } : {},
        },
      },
      // Focus da tastiera sempre ben visibile — importante per chi non usa
      // il mouse o ha difficoltà a seguire un outline sottile.
      MuiButtonBase: {
        defaultProps: { disableRipple: false },
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": {
              outline: "3px solid currentColor",
              outlineOffset: "2px",
            },
          },
        },
      },
    },
  });
}
