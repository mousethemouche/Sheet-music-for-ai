/**
 * Label-spacing geometry of REN-I02, shared by the browser tests that check
 * it (REN-I02 on the catalogue, REN-I03 on the ChatGPT drafts): the labels,
 * staff lines, bar lines and noteheads of an engraving as the reader sees
 * them (text ink from the browser's own glyph metrics), and the checks that
 * no two of them touch and that every label lies inside its system's bounds.
 * Works on an engraving in any same-origin document: text is measured with
 * the fonts of the document that holds it.
 */
import type { LayoutMap } from '@sheet-music/renderer-core';

/** Smallest distance between two labels, or a label and the notation, in px: closer reads as touching. */
const CLEARANCE = 2;
/** Staff lines are 1 px strokes around their path. */
const HALF_STROKE = 0.5;
/** Ledger lines are 1.4 px strokes (the adapter's ledger line style). */
const HALF_LEDGER_STROKE = 0.7;

/** Label kinds, by the groups the adapter draws them in (README, data-* hooks). */
const LABEL_SELECTORS: Readonly<Record<string, string>> = {
  'chord symbol': '.vf-chord-symbol text',
  swing: '.vf-swing text',
  'Roman numeral': '.vf-roman-numeral text',
  'scale degree': '.vf-scale-degree text',
  dynamic: '.vf-dynamic text',
  hairpin: '.vf-hairpin path',
  pedal: '.vf-pedal text',
};

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Drawn {
  readonly kind: string;
  readonly system: number;
  readonly text: string;
  readonly box: Box;
  /** The notehead group a notehead or fingering glyph belongs to. */
  readonly head?: Element;
}

/** One measuring canvas per document: it resolves fonts against that document's faces. */
const contexts = new WeakMap<Document, CanvasRenderingContext2D>();

function measuringContext(owner: Document): CanvasRenderingContext2D {
  let context = contexts.get(owner);
  if (context === undefined) {
    const created = owner.createElement('canvas').getContext('2d');
    if (created === null) {
      throw new Error('no canvas');
    }
    context = created;
    contexts.set(owner, context);
  }
  return context;
}

/** A box of an element's own user space, in the SVG surface (through the system translation). */
function onSurface(
  element: Element,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Box {
  const matrix = (element as SVGGraphicsElement).getCTM();
  if (matrix === null) {
    throw new Error('element is not rendered');
  }
  const a = new DOMPoint(left, top).matrixTransform(matrix);
  const b = new DOMPoint(right, bottom).matrixTransform(matrix);
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** Ink of a text element from the browser's glyph metrics (its SVG box is the whole line box). */
function textInk(text: Element): Box {
  const owner = text.ownerDocument;
  const style = (owner.defaultView ?? window).getComputedStyle(text);
  const context = measuringContext(owner);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const metrics = context.measureText(text.textContent);
  const x = Number(text.getAttribute('x'));
  const y = Number(text.getAttribute('y'));
  return onSurface(
    text,
    x - metrics.actualBoundingBoxLeft,
    y - metrics.actualBoundingBoxAscent,
    x + metrics.actualBoundingBoxRight,
    y + metrics.actualBoundingBoxDescent,
  );
}

function pathBox(path: Element, stroke = 0): Box {
  const box = (path as SVGGraphicsElement).getBBox();
  return onSurface(
    path,
    box.x - stroke,
    box.y - stroke,
    box.x + box.width + stroke,
    box.y + box.height + stroke,
  );
}

const systemOf = (element: Element): number =>
  Number(element.closest('[data-system-index]')?.getAttribute('data-system-index'));

const isFingering = (text: Element): boolean => /^[1-5]$/.test(text.textContent);

/** Labels, staff lines, bar lines and noteheads as drawn in `target`. */
export function drawnParts(target: HTMLElement): {
  readonly labels: readonly Drawn[];
  readonly notation: readonly Drawn[];
} {
  const labels: Drawn[] = [];
  for (const [kind, selector] of Object.entries(LABEL_SELECTORS)) {
    for (const element of target.querySelectorAll(selector)) {
      labels.push({
        kind,
        system: systemOf(element),
        text: element.textContent,
        box: element.tagName.toLowerCase() === 'text' ? textInk(element) : pathBox(element),
      });
    }
  }
  const notation: Drawn[] = [];
  // A notehead group holds its glyph, then the fingering and articulation glyphs of that key.
  for (const head of target.querySelectorAll('.vf-notehead')) {
    const [glyph, ...modifiers] = [...head.querySelectorAll(':scope > text')];
    if (glyph !== undefined) {
      notation.push({
        kind: 'notehead',
        system: systemOf(head),
        text: head.getAttribute('data-note-id') ?? 'rest',
        box: textInk(glyph),
        head,
      });
    }
    for (const fingering of modifiers.filter(isFingering)) {
      labels.push({
        kind: 'fingering',
        system: systemOf(fingering),
        text: fingering.textContent,
        box: textInk(fingering),
        head,
      });
    }
  }
  for (const line of target.querySelectorAll('.vf-stave > path')) {
    notation.push({
      kind: 'staff line',
      system: systemOf(line),
      text: '',
      box: pathBox(line, HALF_STROKE),
    });
  }
  // Bar lines of each stave, and the lines joining the staves of a system.
  for (const line of target.querySelectorAll(
    '.vf-stavebarline > rect, [data-system-index] > rect',
  )) {
    notation.push({ kind: 'bar line', system: systemOf(line), text: '', box: pathBox(line) });
  }
  return { labels, notation };
}

/** The fingering drawn with a note's notehead, and the staff and ledger lines of its system. */
export function fingeringAndLines(
  target: HTMLElement,
  noteId: string,
): { readonly fingering: Box; readonly lines: readonly Box[] } {
  const head = target.querySelector(`.vf-notehead[data-note-id="${noteId}"]`);
  const digit = [...(head?.querySelectorAll(':scope > text') ?? [])].find(isFingering);
  if (head === null || digit === undefined) {
    throw new Error(`no fingering drawn for ${noteId}`);
  }
  const system = head.closest('[data-system-index]');
  const lines = [
    ...[...(system?.querySelectorAll('.vf-stave > path') ?? [])].map((line) =>
      pathBox(line, HALF_STROKE),
    ),
    // Ledger lines are the paths a note group draws itself (stems have their own group).
    ...[...(system?.querySelectorAll('.vf-stavenote > path') ?? [])].map((line) =>
      pathBox(line, HALF_LEDGER_STROKE),
    ),
  ];
  return { fingering: textInk(digit), lines };
}

export const apart = (a: Box, b: Box): boolean =>
  a.right + CLEARANCE <= b.left ||
  b.right + CLEARANCE <= a.left ||
  a.bottom + CLEARANCE <= b.top ||
  b.bottom + CLEARANCE <= a.top;

export const describeBox = (box: Box): string =>
  `[${box.left.toFixed(1)}, ${box.top.toFixed(1)} .. ${box.right.toFixed(1)}, ${box.bottom.toFixed(1)}]`;

const describePart = (part: Drawn): string =>
  `${part.kind} "${part.text}" (system ${part.system}) ${describeBox(part.box)}`;

/** The note group (one per event) a fingering belongs to: a chord's fingerings share it. */
const chordOf = (part: Drawn): Element | null | undefined => part.head?.closest('.vf-stavenote');

/** Every pair of labels, and every label and notation part, that touch. */
export function collisions(labels: readonly Drawn[], notation: readonly Drawn[]): string[] {
  const found: string[] = [];
  labels.forEach((label, position) => {
    for (const other of labels.slice(position + 1)) {
      const sameChord =
        label.kind === 'fingering' &&
        other.kind === 'fingering' &&
        chordOf(label) === chordOf(other);
      if (!sameChord && !apart(label.box, other.box)) {
        found.push(`${describePart(label)} touches ${describePart(other)}`);
      }
    }
    for (const part of notation) {
      const neighbour = Math.abs(part.system - label.system) === 1;
      const own =
        part.system === label.system &&
        (label.kind !== 'fingering' ||
          part.kind === 'bar line' ||
          (part.kind === 'notehead' && part.head !== label.head));
      if ((neighbour || own) && !apart(label.box, part.box)) {
        found.push(`${describePart(label)} touches ${describePart(part)}`);
      }
    }
  });
  return found;
}

/** Labels that stick out of their system's LayoutMap bounds. */
export function outsideSystems(labels: readonly Drawn[], layout: LayoutMap): string[] {
  return labels.flatMap((label) => {
    const bounds = layout.systems[label.system]?.bounds;
    const inside =
      bounds !== undefined &&
      label.box.left >= bounds.x - 0.5 &&
      label.box.top >= bounds.y - 0.5 &&
      label.box.right <= bounds.x + bounds.width + 0.5 &&
      label.box.bottom <= bounds.y + bounds.height + 0.5;
    return inside ? [] : [`${describePart(label)} is outside its system's bounds`];
  });
}
