import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Credentialed and User-Agent-sensitive APIs go through server/index.mjs
      // so that no key is ever shipped to the browser. Keyless, CORS-enabled
      // APIs (Open-Meteo, NASA POWER, GBIF, USGS) are called directly.
      '/api': {
        target: `http://localhost:${process.env.PROXY_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
})
