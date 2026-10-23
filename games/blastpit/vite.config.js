import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5176, strictPort: true },
  preview: { port: 4176 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
