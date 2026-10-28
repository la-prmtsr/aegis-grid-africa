import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Three pages: the landing page (index.html), sign up / log in (auth.html) and the live console (console.html).
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700, // three.js and ethers are large; both pages still load in one request each
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        console: resolve(import.meta.dirname, 'console.html'),
        auth: resolve(import.meta.dirname, 'auth.html'),
      },
    },
  },
  server: { port: 5173 },
});
