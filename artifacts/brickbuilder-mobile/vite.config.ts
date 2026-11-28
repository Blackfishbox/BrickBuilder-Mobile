import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import geometryManifest from './src/features/formats/geometry-manifest.json';
import partPackages from './src/features/parts/catalog.json';
import colorEvidenceManifest from './src/features/catalog/color-evidence-manifest.json';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      disable: process.env.VITE_NATIVE_ANDROID === 'true',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/brickbuilder-192.png', 'icons/brickbuilder-512.png'],
      manifest: {
        name: 'BrickBuilder',
        short_name: 'BrickBuilder',
        description: 'Offlinefähige 3D-Bau-App für Klemmbausteinmodelle auf Android.',
        lang: 'de',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f2e8',
        theme_color: '#214a42',
        icons: [
          {
            src: 'icons/brickbuilder-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/brickbuilder-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        additionalManifestEntries: [{
          url: `${basePath}${colorEvidenceManifest.url}`,
          revision: colorEvidenceManifest.sha256,
        }, {
          url: `${basePath}${geometryManifest.url}`,
          revision: geometryManifest.sha256,
        }, ...partPackages.filter(pkg => pkg.bundled).map(pkg => ({
          url: `${basePath}${pkg.url}`, revision: pkg.sha256,
        }))],
        navigateFallback: `${basePath}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,woff2}', 'licenses/connections/**'],
        // Includes the pinned, compressed offline connection hierarchy chunk.
        // No upstream requests or automatic dataset updates are performed.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three-engine';
          const connectionData = id.match(/\/features\/connections\/data\/(hierarchy-\d+|shadow-\d+|examples-\d+)\.ts(?:\?.*)?$/);
          if (connectionData) return `connection-${connectionData[1]}`;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
