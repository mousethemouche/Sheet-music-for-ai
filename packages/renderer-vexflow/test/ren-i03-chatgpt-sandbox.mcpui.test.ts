/**
 * REN-I03: the scores ChatGPT created in production engrave inside ChatGPT's
 * widget sandbox, checked on the real adapter in headless Chromium.
 *
 * On 2026-10-02 ChatGPT showed "Notation unavailable" for all three drafts
 * (test-fixtures `chatgpt.ts`), which the server had accepted. ChatGPT writes
 * the View into an about:blank iframe (`document.write`) under a CSP whose
 * `font-src` lists `'self'`, the declared resource domains and
 * `*.oaiusercontent.com`, never `data:`; VexFlow's embedded fonts were
 * `url(data:...)` sources, so none loaded and every render failed with
 * RENDER_FAILED. Here the adapter module itself is loaded inside such a frame
 * (same document set-up, the same `font-src`), and for each draft, at the
 * inline widget width and a phone width:
 * - the render resolves (no RENDER_FAILED) and the frame reports no CSP
 *   violation;
 * - every written note has exactly one LayoutMap entry and every chord
 *   symbol is drawn;
 * - the REN-I02 label-spacing checks pass (label-geometry.ts).
 * Shapes the model is likely to send next, derived from draft A, and the
 * adversarial charts of the post-fix review get the same checks.
 */
import type { ScoreSpec, ScoreSpecInput } from '@sheet-music/music-domain';
import type { LayoutMap } from '@sheet-music/renderer-core';
import {
  CHATGPT_STELLA_16,
  CHATGPT_STELLA_REHARM_A,
  CHATGPT_STELLA_REHARM_B,
  type ChordInput,
  type DurationInput,
  type EventInput,
  type MeasureInput,
  bar,
  chord,
  cloneFixture,
  dur,
  member,
  parseFixture,
  pitch,
  rest,
  score,
  staff,
  voice,
} from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { collisions, drawnParts, outsideSystems } from './label-geometry';

type RendererModule = typeof import('../src');

const THEME = { ink: '#18181b', playbackHighlight: '#4f46e5' } as const;
const BAND = 28;
/** ChatGPT's inline widget width, and a 375 px phone minus the player's padding (REN-I02). */
const WIDTHS = [720, 320] as const;

/** The declared resource domain (the MCP server's asset origin in production). */
const ASSET_ORIGIN = 'https://sheet-music.example.com';
/**
 * The widget CSP ChatGPT's sandbox builds for a published app (its apply-csp
 * module) with ASSET_ORIGIN declared, without `upgrade-insecure-requests`
 * and `base-uri` (they concern neither fonts nor this local http origin).
 * `data:` is allowed for images only.
 */
const CHATGPT_WIDGET_CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: https://*.oaiusercontent.com ${ASSET_ORIGIN}`,
  'worker-src blob:',
  `style-src 'self' 'unsafe-inline' https://*.oaiusercontent.com ${ASSET_ORIGIN}`,
  `style-src-elem 'self' 'unsafe-inline' ${ASSET_ORIGIN}`,
  "style-src-attr 'unsafe-inline'",
  `img-src 'self' data: ${ASSET_ORIGIN}`,
  `font-src 'self' https://*.oaiusercontent.com ${ASSET_ORIGIN}`,
  `connect-src 'self' ${ASSET_ORIGIN}`,
  `media-src 'self' ${ASSET_ORIGIN}`,
  "object-src 'none'",
  "frame-src 'none'",
].join('; ');

/** Draft A with every bar of one staff holding one voice of `events` (IDs derived from the bar's). */
function reshaped(staffIndex: number, events: (prefix: string) => EventInput[]): ScoreSpecInput {
  const draft = cloneFixture(CHATGPT_STELLA_REHARM_A);
  return {
    ...draft,
    staves: draft.staves.map((staff, index) =>
      index !== staffIndex
        ? staff
        : {
            ...staff,
            measures: staff.measures.map((measure) => {
              const prefix = `${measure.id}-${staff.id}`;
              return { ...measure, voices: [voice(`${prefix}-v`, events(prefix))] };
            }),
          },
    ),
  };
}

/** Draft A played twice: 16 bars and 32 chord symbols (the second time with "-b" IDs). */
function twice(): ScoreSpecInput {
  const draft = cloneFixture(CHATGPT_STELLA_REHARM_A);
  const again = (measure: MeasureInput): MeasureInput => ({
    ...(JSON.parse(
      JSON.stringify(measure).replace(/"id":"([^"]+)"/g, '"id":"$1-b"'),
    ) as MeasureInput),
    number: measure.number + 8,
  });
  return {
    ...draft,
    staves: draft.staves.map((staff) => ({
      ...staff,
      measures: [...staff.measures, ...staff.measures.map(again)],
    })),
    harmony: [
      ...(draft.harmony ?? []),
      ...(draft.harmony ?? []).map((harmony) => ({
        ...harmony,
        id: `${harmony.id}-b`,
        measureId: `${harmony.measureId}-b`,
      })),
    ],
  };
}

type HarmonyInput = NonNullable<ScoreSpecInput['harmony']>[number];
type ChordSymbolInput = NonNullable<HarmonyInput['chord']>;

/** A chord-symbol root or bass from its spelling: "C#", "Bb", "Cb". */
function pitchClass(spelled: string): ChordSymbolInput['root'] {
  const { step, alter } = pitch(`${spelled}4`);
  return { step, alter };
}

/** A chord of `pitches`, its members `${id}-0`, `${id}-1`... */
function voicing(id: string, pitches: readonly string[], duration: DurationInput): ChordInput {
  return chord(
    id,
    pitches.map((spelled, index) => member(`${id}-${index}`, spelled)),
    duration,
  );
}

/** A chord symbol with only a root and its `display` text, at `offset` whole notes into the bar. */
function symbol(
  id: string,
  measureId: string,
  root: string,
  display: string,
  offset?: { numerator: number; denominator: number },
): HarmonyInput {
  return {
    id,
    measureId,
    ...(offset === undefined ? {} : { offset }),
    chord: { root: pitchClass(root), display },
  };
}

/**
 * A two-hand chord chart in swing as the model sends it: every bar `b<n>`
 * holds one voice per hand from `right` and `left`, and `harmony` gives the
 * bar's chord symbols (all three called with the bar ID).
 */
function chart(fields: {
  readonly slug: string;
  readonly bars: number;
  readonly fifths: number;
  readonly timeSignature?: ScoreSpecInput['timeSignature'];
  readonly right: (bar: string) => EventInput[];
  readonly left: (bar: string) => EventInput[];
  readonly harmony: (bar: string) => HarmonyInput[];
}): ScoreSpecInput {
  const bars = Array.from({ length: fields.bars }, (_, index) => `b${index + 1}`);
  const hand = (side: 'R' | 'L', events: (bar: string) => EventInput[]): MeasureInput[] =>
    bars.map((id, index) => bar(id, index + 1, [voice(`${id}${side}-v`, events(id))]));
  return score({
    id: `scr_ren-i03-${fields.slug}`,
    metadata: { title: fields.slug, tags: ['jazz', 'piano'] },
    ...(fields.timeSignature === undefined ? {} : { timeSignature: fields.timeSignature }),
    keySignature: { fifths: fields.fifths },
    playbackFeel: { type: 'swing', displayText: 'Medium swing' },
    staves: [
      staff('RH', 'right', hand('R', fields.right)),
      staff('LH', 'left', hand('L', fields.left)),
    ],
    harmony: bars.flatMap((id) => fields.harmony(id)),
  });
}

const HALF = dur('half');
const QUARTER = dur('quarter');
const BEAT_3 = { numerator: 1, denominator: 2 };

/**
 * The adversarial charts the post-fix review (2026-10-02) reported as
 * failing: dense accidentals, enharmonic and double spellings, 16 bars,
 * structured symbols. They rendered; its 30 px symbol-to-chord check measured
 * to the chord's left edge, accidentals included, while a symbol starts at
 * the notehead column and the accidentals hang to its left. Their engraving
 * is the same before and after the bundled-bytes fonts. Kept for the
 * rendering checks below under the sandbox CSP.
 */
const ADVERSARIAL_CHARTS: readonly { readonly name: string; readonly input: ScoreSpecInput }[] = [
  {
    name: 'chart against a D major key signature: flats and naturals in every chord',
    input: chart({
      slug: 'against-the-key',
      bars: 8,
      fifths: 2,
      right: (id) => [
        voicing(`${id}R-1`, ['F4', 'Bb4', 'C5', 'Eb5'], HALF),
        voicing(`${id}R-2`, ['F#4', 'B4', 'C#5', 'E5'], HALF),
      ],
      left: (id) => [
        voicing(`${id}L-1`, ['C3', 'Bb3'], HALF),
        voicing(`${id}L-2`, ['C#3', 'B3'], HALF),
      ],
      harmony: (id) => [
        symbol(`${id}-h1`, id, 'C', 'C7#9'),
        symbol(`${id}-h2`, id, 'C#', 'C#m7b5', BEAT_3),
      ],
    }),
  },
  {
    name: 'chart in Gb major: Cb, Fb, E#, B# and double accidentals',
    input: chart({
      slug: 'enharmonic',
      bars: 8,
      fifths: -6,
      right: (id) => [
        voicing(`${id}R-1`, ['Cb4', 'Fb4', 'Abb4', 'Db5'], HALF),
        voicing(`${id}R-2`, ['B#3', 'E#4', 'G##4', 'C#5'], HALF),
      ],
      left: (id) => [
        voicing(`${id}L-1`, ['Cb2', 'Gb2', 'Bbb2'], HALF),
        voicing(`${id}L-2`, ['E#2', 'B#2', 'D##3'], HALF),
      ],
      harmony: (id) => [
        symbol(`${id}-h1`, id, 'Cb', 'Cbm(maj7)'),
        symbol(`${id}-h2`, id, 'E#', 'E#7#9', BEAT_3),
      ],
    }),
  },
  {
    name: 'chart of 16 bars, a chord symbol every two beats over flatted voicings',
    input: chart({
      slug: 'sixteen-bars',
      bars: 16,
      fifths: -2,
      right: (id) => [
        voicing(`${id}R-1`, ['A4', 'C5', 'D5', 'F5'], HALF),
        voicing(`${id}R-2`, ['Ab4', 'C5', 'Db5', 'F5'], HALF),
      ],
      left: (id) => [
        voicing(`${id}L-1`, ['D2', 'C3'], HALF),
        voicing(`${id}L-2`, ['G2', 'F3'], HALF),
      ],
      harmony: (id) => [
        symbol(`${id}-h1`, id, 'D', 'Dm9'),
        symbol(`${id}-h2`, id, 'G', 'G13b9', BEAT_3),
      ],
    }),
  },
  {
    name: 'chart in 3/4 of structured symbols: alterations, slash bass, an analysis',
    input: chart({
      slug: 'structured-symbols',
      bars: 8,
      fifths: 3,
      timeSignature: { numerator: 3, denominator: 4 },
      right: (id) => [
        voicing(`${id}R-1`, ['G#4', 'C5', 'D5', 'F#5'], QUARTER),
        voicing(`${id}R-2`, ['G4', 'B4', 'C#5', 'F5'], QUARTER),
        voicing(`${id}R-3`, ['F#4', 'A4', 'C#5', 'E5'], QUARTER),
      ],
      left: (id) => [voicing(`${id}L-1`, ['E2', 'B2', 'D3'], dur('half', 1))],
      harmony: (id) => [
        {
          id: `${id}-h1`,
          measureId: id,
          chord: {
            root: pitchClass('E'),
            quality: 'dominant',
            extension: 13,
            alterations: ['b9', '#11', 'b13', 'sus4'],
            bass: pitchClass('G#'),
          },
        },
        {
          id: `${id}-h2`,
          measureId: id,
          offset: { numerator: 1, denominator: 4 },
          chord: {
            root: pitchClass('A'),
            quality: 'half-diminished',
            extension: 11,
            bass: pitchClass('Eb'),
          },
          analysis: { romanNumeral: 'iiø7/vi', function: 'predominant' },
        },
        {
          id: `${id}-h3`,
          measureId: id,
          offset: { numerator: 2, denominator: 4 },
          chord: { root: pitchClass('F#'), quality: 'diminished', extension: 7 },
        },
      ],
    }),
  },
];

const CASES: readonly { readonly name: string; readonly input: ScoreSpecInput }[] = [
  { name: 'ChatGPT draft: 16 bars of voicings (CHATGPT_STELLA_16)', input: CHATGPT_STELLA_16 },
  { name: 'ChatGPT draft A: chords and 16 chord symbols', input: CHATGPT_STELLA_REHARM_A },
  { name: 'ChatGPT draft B: chords and 16 chord symbols', input: CHATGPT_STELLA_REHARM_B },
  {
    name: 'draft A with whole-note clusters of seconds',
    input: reshaped(0, (id) => [
      chord(
        `${id}-c`,
        ['C5', 'D5', 'Eb5', 'F5'].map((pitch, index) => member(`${id}-c-${index}`, pitch)),
        'whole',
      ),
    ]),
  },
  {
    name: 'draft A with low left-hand shells holding a second',
    input: reshaped(1, (id) => [
      chord(
        `${id}-c`,
        ['Bb1', 'A2', 'Bb2'].map((pitch, index) => member(`${id}-c-${index}`, pitch)),
        'whole',
      ),
    ]),
  },
  {
    name: 'draft A comped in quarters with rests',
    input: reshaped(0, (id) => [
      rest(`${id}-r1`, 'quarter'),
      chord(
        `${id}-c1`,
        ['A4', 'C5', 'Eb5', 'G5'].map((pitch, index) => member(`${id}-c1-${index}`, pitch)),
        'quarter',
      ),
      rest(`${id}-r2`, 'quarter'),
      chord(
        `${id}-c2`,
        ['Ab4', 'Bb4', 'D5', 'Gb5'].map((pitch, index) => member(`${id}-c2-${index}`, pitch)),
        'quarter',
      ),
    ]),
  },
  {
    name: 'draft A with dotted halves, double flats and sharps',
    input: reshaped(0, (id) => [
      chord(
        `${id}-c1`,
        ['Bbb4', 'Db5', 'Fb5'].map((pitch, index) => member(`${id}-c1-${index}`, pitch)),
        { value: 'half', dots: 1 },
      ),
      chord(
        `${id}-c2`,
        ['C#5', 'E#5', 'G#5'].map((pitch, index) => member(`${id}-c2-${index}`, pitch)),
        'quarter',
      ),
    ]),
  },
  { name: 'draft A twice: 16 bars, 32 chord symbols', input: twice() },
  ...ADVERSARIAL_CHARTS,
];

interface Sandbox {
  readonly frame: HTMLIFrameElement;
  readonly document: Document;
  readonly renderer: RendererModule;
  /** Every CSP violation the frame reported, as "directive blocked-URI". */
  readonly violations: string[];
}

/**
 * A frame set up as ChatGPT sets up a widget: a sandboxed about:blank iframe
 * whose document is written with `document.write`, the CSP first in its head,
 * then a script that imports the adapter module (the real one, from the test
 * server) into the frame, where it registers its fonts.
 */
async function openChatGptSandbox(): Promise<Sandbox> {
  const frame = document.createElement('iframe');
  frame.sandbox.value = 'allow-scripts allow-same-origin allow-forms allow-popups';
  frame.style.cssText = 'width: 1100px; height: 2400px; border: 0;';
  document.body.append(frame);
  const view = frame.contentWindow;
  const sandboxDocument = frame.contentDocument;
  if (view === null || sandboxDocument === null) {
    throw new Error('The sandbox frame has no document');
  }
  sandboxDocument.open();
  // document.open() drops the listeners of the document and its window: listen after it.
  const violations: string[] = [];
  view.addEventListener('securitypolicyviolation', (event) => {
    violations.push(`${event.effectiveDirective} ${event.blockedURI.slice(0, 32)}`);
  });
  const moduleUrl = new URL('../src/index.ts', import.meta.url).href;
  sandboxDocument.write(
    [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${CHATGPT_WIDGET_CSP}">`,
      `<script>window.rendererModule = import(${JSON.stringify(moduleUrl)});</script>`,
      '</head><body style="margin: 0; background: #ffffff"></body></html>',
    ].join(''),
  );
  sandboxDocument.close();
  const loading = (view as unknown as { rendererModule: Promise<RendererModule> }).rendererModule;
  return { frame, document: sandboxDocument, renderer: await loading, violations };
}

/** IDs of the written notes of a score: note events and chord members (rests have no notehead). */
function writtenNoteIds(score: ScoreSpec): string[] {
  return score.staves.flatMap((staff) =>
    staff.measures.flatMap((measure) =>
      measure.voices.flatMap((lane) =>
        lane.events.flatMap((event) => {
          switch (event.type) {
            case 'note':
              return [event.id];
            case 'chord':
              return event.notes.map((written) => written.id);
            default:
              return [];
          }
        }),
      ),
    ),
  );
}

let sandbox: Sandbox;

beforeAll(async () => {
  await page.viewport(1200, 1200);
  sandbox = await openChatGptSandbox();
});

afterAll(() => {
  sandbox.frame.remove();
});

async function engravedInSandbox<T>(
  score: ScoreSpec,
  width: number,
  check: (target: HTMLElement, layoutMap: LayoutMap) => T,
): Promise<T> {
  const target = sandbox.document.createElement('div');
  sandbox.document.body.append(target);
  const renderer = sandbox.renderer.createVexFlowRendererFactory()();
  try {
    const { layoutMap } = await renderer.render(score, target, {
      width,
      theme: THEME,
      annotationBandHeight: BAND,
    });
    return check(target, layoutMap);
  } finally {
    renderer.destroy();
    target.remove();
  }
}

describe.each(CASES)('REN-I03 in the ChatGPT widget sandbox: $name', ({ input }) => {
  const score = parseFixture(input);

  it.each(WIDTHS)(
    'engraves every note and chord symbol, labels apart, without a CSP violation at %i px',
    async (width) => {
      await engravedInSandbox(score, width, (target, layoutMap) => {
        const drawnHarmony = [...target.querySelectorAll('.vf-chord-symbol')].map((group) =>
          group.getAttribute('data-harmony-id'),
        );
        const { labels, notation } = drawnParts(target);

        expect(sandbox.violations).toEqual([]);
        expect([...layoutMap.notes.keys()].sort()).toEqual(writtenNoteIds(score).sort());
        expect(drawnHarmony.sort()).toEqual((score.harmony ?? []).map(({ id }) => id).sort());
        expect(collisions(labels, notation)).toEqual([]);
        expect(outsideSystems(labels, layoutMap)).toEqual([]);
        layoutMap.systems.forEach((system, index) => {
          const next = layoutMap.systems[index + 1];
          if (next !== undefined) {
            expect(system.bounds.y + system.bounds.height).toBeLessThan(next.annotationBand.y);
          }
        });
      });
    },
  );
});
