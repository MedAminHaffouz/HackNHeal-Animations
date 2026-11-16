import { defineConfig } from 'vite';

// Multi-page build: the gallery plus one standalone page per visual,
// so each one can be embedded on its own with an <iframe>.
const pages = ['index', 'dna', 'protein', 'mri', 'xray'];

export default defineConfig({
  // Relative asset URLs → the dist/ folder works from any sub-path or static host.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p, `${p}.html`])),
    },
  },
  server: { host: true },
});
