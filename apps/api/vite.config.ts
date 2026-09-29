import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

// NestJS relies on legacy decorators and emitDecoratorMetadata, which oxc does
// not emit: SWC compiles every file (settings come from the nearest tsconfig).
// Workspace packages are linked sources, so Vite bundles them while npm
// dependencies stay external and resolve from node_modules at runtime.
// Two entries: the process (src/main.ts -> dist/main.js) and the Vercel
// Function adapter (api/_serverless.ts -> dist/serverless.js, #16).
export default defineConfig({
  plugins: [swc.vite()],
  // public/ is Vercel's static output (robots.txt), not part of the server bundle.
  publicDir: false,
  build: {
    ssr: true,
    rolldownOptions: {
      input: { main: 'src/main.ts', serverless: 'api/_serverless.ts' },
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
});
