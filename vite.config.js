import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built `dist/` folder works from any sub-path,
  // a static file share, or by simply opening index.html over http(s).
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    // mermaid is a large, lazily loaded chunk; silence the size warning.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 5173,
  },
});
