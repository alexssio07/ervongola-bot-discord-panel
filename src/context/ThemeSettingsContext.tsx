import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  createAppTheme,
  defaultThemeSettings,
  type FontSize,
  type ThemeMode,
  type ThemePalette,
  type ThemeSettings,
} from "../theme";

const STORAGE_KEY = "ervongola_panel_theme";

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultThemeSettings;
    return { ...defaultThemeSettings, ...JSON.parse(raw) };
  } catch {
    return defaultThemeSettings;
  }
}

interface ThemeSettingsContextValue {
  settings: ThemeSettings;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
  setHighContrast: (value: boolean) => void;
  setFontSize: (fontSize: FontSize) => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(null);

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(loadSettings);

  function persist(next: ThemeSettings) {
    setSettings(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const value = useMemo<ThemeSettingsContextValue>(
    () => ({
      settings,
      setMode: (mode) => persist({ ...settings, mode }),
      setPalette: (palette) => persist({ ...settings, palette }),
      setHighContrast: (highContrast) => persist({ ...settings, highContrast }),
      setFontSize: (fontSize) => persist({ ...settings, fontSize }),
    }),
    [settings]
  );

  const theme = useMemo(() => createAppTheme(settings), [settings]);

  return (
    <ThemeSettingsContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeSettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-locato col suo Provider, pattern standard
export function useThemeSettings(): ThemeSettingsContextValue {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) throw new Error("useThemeSettings deve essere usato dentro <ThemeSettingsProvider>");
  return ctx;
}
