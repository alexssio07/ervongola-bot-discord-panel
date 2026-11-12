import ChatIcon from "@mui/icons-material/Chat";
import ContrastIcon from "@mui/icons-material/Contrast";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import LogoutIcon from "@mui/icons-material/Logout";
import MovieIcon from "@mui/icons-material/Movie";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { Navigate, Route, BrowserRouter as Router, Routes, Link as RouterLink } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeSettingsProvider, useThemeSettings } from "./context/ThemeSettingsContext";
import LoginPage from "./pages/LoginPage";
import MovieFormPage from "./pages/movies/MovieFormPage";
import MoviesListPage from "./pages/movies/MoviesListPage";
import PhrasesPage from "./pages/PhrasesPage";
import VoicePage from "./pages/VoicePage";
import type { FontSize } from "./theme";

function TopBar() {
  const { isAuthenticated, logout } = useAuth();
  const { settings, setMode, setPalette, setHighContrast, setFontSize } = useThemeSettings();

  return (
    <AppBar position="static">
      <Toolbar sx={{ flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Er Vongola — Pannello
        </Typography>

        {isAuthenticated && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Button color="inherit" component={RouterLink} to="/movies" startIcon={<MovieIcon />}>
              Film
            </Button>
            <Button color="inherit" component={RouterLink} to="/phrases" startIcon={<ChatIcon />}>
              Frasi
            </Button>
            <Button color="inherit" component={RouterLink} to="/audio" startIcon={<QueueMusicIcon />}>
              Audio
            </Button>

            <Tooltip title={settings.mode === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}>
              <IconButton
                color="inherit"
                onClick={() => setMode(settings.mode === "dark" ? "light" : "dark")}
              >
                {settings.mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>

            <Tooltip title="Palette per daltonismo (Okabe-Ito)">
              <IconButton
                color="inherit"
                onClick={() => setPalette(settings.palette === "daltonic" ? "standard" : "daltonic")}
                sx={{ opacity: settings.palette === "daltonic" ? 1 : 0.6 }}
              >
                <VisibilityIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title="Alto contrasto">
              <IconButton
                color="inherit"
                onClick={() => setHighContrast(!settings.highContrast)}
                sx={{ opacity: settings.highContrast ? 1 : 0.6 }}
              >
                <ContrastIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title="Dimensione testo">
              <Select
                value={settings.fontSize}
                onChange={(e) => setFontSize(e.target.value as FontSize)}
                size="small"
                variant="standard"
                disableUnderline
                sx={{ color: "inherit", "& .MuiSvgIcon-root": { color: "inherit" } }}
                renderValue={() => <TextIncreaseIcon fontSize="small" />}
              >
                <MenuItem value="normale">Normale</MenuItem>
                <MenuItem value="grande">Grande</MenuItem>
                <MenuItem value="molto-grande">Molto grande</MenuItem>
              </Select>
            </Tooltip>

            <Tooltip title="Esci">
              <IconButton color="inherit" onClick={logout}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/movies"
        element={
          <ProtectedRoute>
            <MoviesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/movies/:id"
        element={
          <ProtectedRoute>
            <MovieFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/phrases"
        element={
          <ProtectedRoute>
            <PhrasesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audio"
        element={
          <ProtectedRoute>
            <VoicePage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/movies" replace />} />
      <Route path="*" element={<Navigate to="/movies" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeSettingsProvider>
      <AuthProvider>
        <Router>
          <TopBar />
          <Box component="main" sx={{ py: 4 }}>
            <Container maxWidth={false} sx={{ px: { xs: 1.5, sm: 2, lg: 2.5 } }}>
              <AppRoutes />
            </Container>
          </Box>
        </Router>
      </AuthProvider>
    </ThemeSettingsProvider>
  );
}

export default App;
