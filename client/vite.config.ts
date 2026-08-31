import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The chat is served under /chat on the same domain as the PHP website,
  // so built asset URLs must be prefixed. The WebSocket (/irc) and API (/api)
  // stay origin-absolute and are proxied to the gateway.
  base: '/chat/',
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
