import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
    },
  },
  server: {
    // In sviluppo il frontend (Vite, porta 5173) e il backend Flask (porta
    // 5000) girano come processi separati: questo proxy inoltra le chiamate
    // /api/* al backend così il codice può usare sempre percorsi relativi
    // (vedi src/api/client.ts), niente CORS da configurare in dev, e lo
    // stesso pattern di path relativi funziona anche dietro un reverse proxy
    // in produzione (frontend e backend sotto la stessa origine esterna).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
});
