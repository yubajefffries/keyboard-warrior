import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        inputFidelity: resolve(__dirname, 'harness/input-fidelity.html'),
        legibility: resolve(__dirname, 'harness/legibility.html'),
        creatures: resolve(__dirname, 'harness/creatures.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
