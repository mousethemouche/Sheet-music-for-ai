import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Globals are disabled, so Testing Library cannot register its automatic
// cleanup: unmount rendered trees after every component test.
afterEach(() => {
  cleanup();
});

/** The Element methods jsdom lacks and the Radix primitives of @sheet-music/ui call. */
interface MissingElementMethods {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
}

// jsdom has no pointer capture and no scrolling: the Slider captures the
// pointer on press, and list-like primitives scroll the active item into view.
// Without them a pointer on a slider raises unhandled errors that fail the
// whole run. Guarded, so a real implementation (a newer jsdom) wins. Reached
// through globalThis because the root TypeScript program has no DOM library.
// No global ResizeObserver on purpose: the test harnesses install their own
// counting fakes.
const { Element } = globalThis as unknown as { Element: { prototype: MissingElementMethods } };
const element = Element.prototype;
element.hasPointerCapture ??= () => false;
element.setPointerCapture ??= () => undefined;
element.releasePointerCapture ??= () => undefined;
element.scrollIntoView ??= () => undefined;
