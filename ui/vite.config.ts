import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Mode 'lib': IIFE module loaded by JarvYZ via @yz-dev/react-dynamic-module.
//   - Externalises react/react-dom (host injects via window globals).
//   - Bundles MUI/emotion + three. Theme propagates via the ledfx pattern
//     (theme prop + the module's own ThemeProvider seeded with it). Same
//     pattern proven by the music + people + wakeword-trainer satellite UIs.
//
// Mode 'pages' (default): standalone SPA. Built into ../yz_body/static/ so a
// `pip install yz-body` user gets a working UI at http://127.0.0.1:9005/.
const libConfig: UserConfig = {
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'YzBody',
      formats: ['iife'],
      fileName: () => 'yz-body.iife.js',
    },
    // Zustand v5 transitively pulls in `use-sync-external-store/shim/
    // with-selector` which is CJS-only and does `require("react")`. Vite
    // leaves those require() calls in place because react is external — but
    // the IIFE has no module system, so they fail at runtime ("require is
    // not defined"). Inject a tiny `require` shim that resolves the
    // externalized modules from window globals. Same gotcha + fix as the
    // music/people satellites.
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: { react: 'React', 'react-dom': 'ReactDOM' },
        exports: 'named',
        extend: true,
        banner:
          'var require = function(id) {' +
          ' if (id === "react") return window.React;' +
          ' if (id === "react-dom") return window.ReactDOM;' +
          ' throw new Error("require not handled: " + id);' +
          ' };',
      },
    },
  },
}

const SAT = process.env.VITE_SATELLITE_URL || 'http://127.0.0.1:9005'

const pagesConfig: UserConfig = {
  plugins: [react()],
  server: {
    port: 5185,
    host: '127.0.0.1',
    // Forward the satellite-native routes to a running body daemon so the
    // standalone SPA works in dev. In production the satellite serves the
    // SPA itself (same origin -> no proxy needed).
    proxy: {
      '/health': SAT,
      '/settings': SAT,
      '/characters': SAT,
      '/clips': SAT,
      '/character': SAT,
      '/open_folder': SAT,
      '/assets': SAT,
      '/events': { target: SAT, ws: true },
    },
  },
  build: {
    // Pages-mode output lands INSIDE the Python package so a `pip install`
    // user gets a working UI out of the box. Rebuild with `npm run build:pages`.
    outDir: fileURLToPath(new URL('../yz_body/static', import.meta.url)),
    emptyOutDir: true,
  },
}

export default defineConfig(({ mode }) => (mode === 'lib' ? libConfig : pagesConfig))
