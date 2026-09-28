import { defineConfig } from 'vite';

// Server bundle. Workspace packages are bundled from source; npm dependencies
// stay external. The View is built separately by vite.view.config.ts.
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
});
