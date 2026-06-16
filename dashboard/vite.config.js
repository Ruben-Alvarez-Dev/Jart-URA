import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api → Jart-URA management API (:9100) so the dashboard
// can fetch real /v1/registry data instead of the bundled mock when desired.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3200,
    proxy: {
      '/api': {
        target: process.env.JART_URA_BASE || 'http://localhost:9100',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
