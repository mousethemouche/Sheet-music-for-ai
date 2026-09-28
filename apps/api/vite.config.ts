import swc from 'unplugin-swc';
import { defineConfig } from 'vite';

// NestJS relies on legacy decorators and emitDecoratorMetadata, which oxc does
// not emit: SWC compiles every file (settings come from the nearest tsconfig).
// Workspace packages are linked sources, so Vite bundles them into dist/main.js
// while npm dependencies stay external and resolve from node_modules at runtime.
export default defineConfig({
  plugins: [swc.vite()],
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
  },
});
