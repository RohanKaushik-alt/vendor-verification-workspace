import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express backend so the frontend can use
// relative URLs in development too.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 4000}`,
        changeOrigin: true,
      },
    },
  },
});
