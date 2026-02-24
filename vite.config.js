import { defineConfig } from 'vite'

// Live dev: serves public/ with HMR and proxies Signal K API/WebSocket to Docker.
// Start Signal K with: npm run dev:docker
// Then run: npm run dev  and open http://localhost:5173/
export default defineConfig({
  root: 'public',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/signalk': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/open-wind/check-signalk': { target: 'http://localhost:3000', changeOrigin: true },
      '/open-wind/check-local-signalk': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
