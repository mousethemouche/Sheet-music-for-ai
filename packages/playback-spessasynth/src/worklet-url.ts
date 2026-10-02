/**
 * The worklet processor of the pinned spessasynth_lib (4.3.14), which
 * `workletModuleUrl` must serve: the processor and the library share a
 * private message protocol. Apps may not import SpessaSynth, so the adapter
 * hands them the file through this Vite asset import: the app's Vite build
 * emits the file and this is its URL (relative to the page, or a `data:` URL
 * when the build inlines assets). Resolve it to an absolute URL, for example
 * `new URL(SPESSASYNTH_PROCESSOR_URL, location.href).href`; the host CSP must
 * allow it (#11, #16).
 */
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export const SPESSASYNTH_PROCESSOR_URL: string = processorUrl;
