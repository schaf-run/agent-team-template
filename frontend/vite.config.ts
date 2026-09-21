import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), wasm()],
  // WASM decoders (e.g. MeshoptDecoder) and worker bundles both need
  // ESM output; vite-plugin-wasm handles native `import ... from './x.wasm'`
  // module instantiation, and setting the worker output format to ES
  // modules keeps `new Worker(new URL(...))` imports (including any wasm
  // they import) working consistently between dev and build. Targeting
  // esnext means top-level await (used by wasm module init) works natively,
  // so vite-plugin-top-level-await isn't needed (see the plugin's own docs).
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  build: {
    target: 'esnext',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
