import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '.',
    assetsDir: 'assets',
    sourcemap: false,
    emptyOutDir: false,
  },
  server: {
    open: true,
  },
});
