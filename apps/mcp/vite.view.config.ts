import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// MCP Apps View: the React app rendered by the host in a sandboxed iframe.
// vite-plugin-singlefile inlines every script/style/asset so the result is ONE
// self-contained HTML document (dist/view/index.html) that the server exposes
// as a ui:// resource (#11).
export default defineConfig({
  root: fileURLToPath(new URL('./view', import.meta.url)),
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('./dist/view', import.meta.url)),
    emptyOutDir: true,
  },
});
