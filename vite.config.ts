import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const buildVersion = isBuild ? Date.now().toString() : 'dev';

  if (isBuild) {
    const publicDir = path.resolve(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    fs.writeFileSync(
      path.resolve(publicDir, 'version.json'),
      JSON.stringify({ version: buildVersion }, null, 2)
    );
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'Lumos App',
          short_name: 'Lumos',
          description: 'Plataforma interna da Lumos Studio',
          theme_color: '#0a0a0a',
          background_color: '#0a0a0a',
          display: 'standalone',
          // Sem trava de orientação: no tablet (e no celular) o app pode girar
          // para paisagem. O layout é responsivo e se adapta à largura.
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          // Apaga o precache das versões antigas em vez de acumular: cache
          // velho é justamente quem serve o índice que aponta pra arquivo que
          // não existe mais.
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Handlers de Web Push (push + notificationclick) — arquivo em public/.
          importScripts: ['/push-sw.js'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
            }
          ]
        }
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(buildVersion),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      // Garante uma única cópia de React em dev (evita "Invalid hook call" quando
      // o otimizador do Vite pré-empacota libs como @react-oauth/google).
      dedupe: ['react', 'react-dom'],
    },
  };
})
