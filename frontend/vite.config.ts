import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Local dev only: makes /api/* look same-origin to the browser (http://localhost:5173)
    // even though it's forwarded to the Express server on :3001 — this sidesteps CORS and
    // cross-origin cookie subtlety entirely. Has no effect on `vite build`/Vercel hosting.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
