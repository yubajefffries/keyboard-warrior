import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        inputFidelity: resolve(__dirname, 'harness/input-fidelity.html'),
        legibility: resolve(__dirname, 'harness/legibility.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
