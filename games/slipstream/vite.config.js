import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5177, strictPort: true },
  preview: { port: 4177 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
