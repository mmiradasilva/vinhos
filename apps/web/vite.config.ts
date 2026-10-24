import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same origin in development: the browser talks to :5173 and /api is proxied to the API (sign-in Q15).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
