import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';
const port = parseInt(process.env.VITE_PORT || '5173', 10);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
