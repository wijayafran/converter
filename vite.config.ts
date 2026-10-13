import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const BACKEND_TARGET =
  process.env.VITE_MIGRATION_SERVER_URL ?? 'http://127.0.0.1:4318'

export default defineConfig({
  base: '/converter/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Browser calls `/api/*` (same-origin) and vite forwards to the
      // local backend. This removes any CORS concern during development
      // and keeps the frontend bundle free of hard-coded host:port values.
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
})
