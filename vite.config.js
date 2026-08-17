import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // mapbox-gl's lazy-loaded chunk is ~2.3MB, over the 2MiB default —
        // raise the precache ceiling rather than exclude it from the PWA's
        // offline cache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Toolber',
        short_name: 'Toolber',
        description: 'Neighborhood tool-lending — why buy? borrow.',
        theme_color: '#16181B',
        background_color: '#ECEAE4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
