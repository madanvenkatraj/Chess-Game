import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Web Worker AI runner will be bundled with the `?worker` suffix; this keeps
  // the build set up for it from day one.
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/sse': { target: 'http://localhost:3000' },
      '/send': { target: 'http://localhost:3000' },
    },
  },
  resolve: {
    alias: {
      '@engine': '/client/src/engine',
      '@state': '/client/src/state',
      '@persistence': '/client/src/persistence',
      '@ui': '/client/src/ui',
      '@test': '/test',
    },
  },
  test: {
    // ai-search.test.js uses node:test's own runner and is run by the `test`
    // npm script directly; vitest must not try to load it.
    // wsDrive*.test.js are node:test debug scripts (run like ai-search, not by vitest).
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**', 'test/ai-search.test.js', 'test/wsDrive.test.js', 'test/wsDrive2.test.js', 'test/gameReview.test.js'],
    // Deep AI searches (hard difficulty) can legitimately take a few seconds.
    testTimeout: 60000,
  },
})
