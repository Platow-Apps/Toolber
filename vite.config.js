import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      workbox: {
        // mapbox-gl is a ~1.9MB lazy chunk that Search only imports when the
        // visitor switches to Map view. Precaching it would download it for
        // everyone on first load and defeat that lazy-load entirely, so it is
        // excluded from the precache manifest and cached on first real use
        // instead. Everything else still works offline from the precache.
        globIgnores: ['**/ToolMap-*.js', '**/mapbox-gl*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(ToolMap|mapbox-gl).*\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'toolber-map',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Separate maskable art: Android crops the icon to a circle/squircle,
          // and the "any" icons run edge to edge, so their corners would be cut.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
