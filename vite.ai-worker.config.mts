import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  configFile: false,
  resolve: {
    alias: {
      '@engine': resolve(projectRoot, 'client/src/engine'),
      '@state': resolve(projectRoot, 'client/src/state'),
      '@persistence': resolve(projectRoot, 'client/src/persistence'),
      '@ui': resolve(projectRoot, 'client/src/ui'),
    },
  },
  build: {
    target: 'es2022',
    minify: false,
    emptyOutDir: false,
    lib: {
      entry: resolve(projectRoot, 'client/src/ai/ai.worker.ts'),
      formats: ['es'],
      fileName: () => 'ai.worker.bundle.js',
    },
    outDir: resolve(projectRoot, 'client/src/ai'),
    rollupOptions: {
      output: { entryFileNames: 'ai.worker.bundle.js' },
    },
  },
})
