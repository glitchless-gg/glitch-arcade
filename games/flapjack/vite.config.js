import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5181, strictPort: true },
  preview: { port: 4181 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
