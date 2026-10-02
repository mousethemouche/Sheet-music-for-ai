import { defineConfig } from 'vite';

// Server bundle. Workspace packages are bundled from source; npm dependencies
// stay external. The View is built separately by vite.view.config.ts.
// Two entries: the process (src/main.ts -> dist/server/main.js) and the Vercel
// Function adapter (api/_serverless.ts -> dist/server/serverless.js, #16).
export default defineConfig({
  build: {
    ssr: true,
    rolldownOptions: {
      input: { main: 'src/main.ts', serverless: 'api/_serverless.ts' },
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
});
