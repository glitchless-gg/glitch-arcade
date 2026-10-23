import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5182, strictPort: true },
  preview: { port: 4182 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
