import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy the IRC WebSocket to the backend during development.
      '/irc': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // Profile/admin API + uploaded avatars live on the backend too.
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/avatars': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
