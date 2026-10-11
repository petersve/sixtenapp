import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Pluggappen', short_name: 'Plugg', lang: 'sv', display: 'standalone',
      background_color: '#111826', theme_color: '#111826', start_url: '/',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
    },
    workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png}'] }
  })]
});
