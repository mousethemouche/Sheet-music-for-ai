/**
 * @sheet-music/renderer-vexflow
 *
 * VexFlow adapter implementing the renderer-core port (ADR-004,
 * RENDER_PLAYBACK_PORTS.md §2). The only package allowed to import VexFlow.
 */
export { createVexFlowRendererFactory, type VexFlowRendererOptions } from './renderer';
export { loadBundledFonts } from './fonts';
