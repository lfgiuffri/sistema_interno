import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    // PWA (mejora PRD §10.12): instalable en desktop/móvil, además del build Capacitor.
    // Sin precache de la API: los datos son siempre en vivo; el SW solo sirve el shell.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sistema Interno — Positive Media',
        short_name: 'Sistema Interno',
        description: 'Administración de Positive Media: clientes, abonos, proyectos, tareas, sueldos.',
        lang: 'es-AR',
        theme_color: '#0F7660',
        background_color: '#fafafa',
        display: 'standalone',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Nunca cachear la API ni el socket: datos siempre frescos.
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 8100,
  },
})
