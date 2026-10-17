import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // GitHub Pages serves the app under /<repository>/; VITE_BASE sets that path in the Pages build.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    // The GitHub Pages demo runs the server's route code in the browser: use the data layer's
    // browser entry (no Excel/Google modules) and small browser versions of node:crypto and node:fs.
    alias: {
      '@valet/sheets-integration': here('../sheets-integration/src/core.ts'),
      'node:crypto': here('./src/demo/shims/node-crypto.ts'),
      'node:fs': here('./src/demo/shims/node-fs.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
