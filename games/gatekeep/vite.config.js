import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5178, strictPort: true },
  preview: { port: 4178 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
