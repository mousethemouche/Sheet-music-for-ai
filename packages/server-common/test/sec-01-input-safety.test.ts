/**
 * SEC-01 (issue #24): model-generated input cannot inject CSS or script
 * through colors, cannot pollute prototypes, cannot point the server or the
 * View at an external asset, and free text is either kept as inert data or
 * rejected, never echoed in errors or split across log lines.
 *
 * Payloads go through the real CreateScore use case (the entry point of both
 * transports) and the real envelope/logger of this package. The ScoreSpec
 * rules themselves (every color form, every limit) stay in the #2 tables;
 * only the security-relevant shapes are listed here.
 */
import {
  type AppResult,
  CreateScore,
  type ScoreDraft,
  type ScoreDraftRepository,
  createDraftExpiryPolicy,
} from '@sheet-music/music-application';
import type { CreateScoreOutput } from '@sheet-music/music-contracts';
import { describe, expect, it } from 'vitest';
import { createLogger, toHttpError } from '../src/index';

const OWNER = Object.freeze({ userId: 'user-a' });
const T0 = new Date(Date.UTC(2026, 8, 28, 12, 0, 0));

function harness() {
  const created: ScoreDraft[] = [];
  const drafts: ScoreDraftRepository = {
    create: (_owner, draft) => {
      created.push(draft);
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    update: () => Promise.resolve('stale'),
    delete: () => Promise.resolve(),
  };
  const createScore = new CreateScore({
    drafts,
    ids: { newScoreId: () => 'scr_sec01' },
    clock: { now: () => T0 },
    expiry: createDraftExpiryPolicy(),
  });
  return { created, create: (input: unknown) => createScore.execute(OWNER, input) };
}

/** A one-bar score with one teaching annotation, as a model would send it (no id, no revision). */
function score(annotation: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    metadata: { title: 'Safety' },
    tempo: { bpm: 120 },
    timeSignature: { numerator: 4, denominator: 4 },
    staves: [
      {
        id: 'rh',
        hand: 'right',
        measures: [
          {
            id: 'm1',
            number: 1,
            voices: [
              {
                id: 'v1',
                events: [
                  {
                    id: 'n1',
                    type: 'note',
                    pitch: { step: 'C', alter: 0, octave: 4 },
                    duration: { value: 'whole' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    annotations: [{ id: 'a1', color: '#ff69b4', noteIds: ['n1'], text: 'Root', ...annotation }],
  };
}

/** JSON as it arrives on the wire: JSON.parse makes "__proto__" an own, enumerable key. */
function wire(value: unknown, replace: readonly [string, string] = ['', '']): unknown {
  return JSON.parse(JSON.stringify(value).replace(replace[0], replace[1]));
}

function rejection(result: AppResult<CreateScoreOutput>) {
  if (result.ok) {
    throw new Error('expected a rejection');
  }
  return result.error;
}

function prototypeIsClean(): boolean {
  return !('polluted' in {}) && !('isAdmin' in {});
}

describe('SEC-01 colors cannot carry CSS or script', () => {
  it.each([
    'url(https://evil.example.test/track.png)',
    'red;background-image:url(https://evil.example.test/x)',
    'expression(alert(1))',
    'javascript:alert(1)',
    'var(--brand)',
    '#ff0000" onmouseover="alert(1)',
    '</style><script>alert(1)</script>',
    ' hotpink',
  ])('rejects %j without storing or echoing it', async (color) => {
    const { created, create } = harness();

    const error = rejection(await create({ score: score({ color }) }));

    expect(error.code).toBe('SCORE_VALIDATION_FAILED');
    expect(error.details.map(({ path }) => path)).toEqual([['score', 'annotations', 0, 'color']]);
    expect(created).toEqual([]);
    expect(JSON.stringify(toHttpError(error, 'corr-sec01-color').body)).not.toContain(color.trim());
  });

  it('stores an accepted color only in the canonical #rrggbb form', async () => {
    const { created, create } = harness();

    expect((await create({ score: score({ color: 'HotPink' }) })).ok).toBe(true);
    expect(created[0]?.spec.annotations[0]?.color).toBe('#ff69b4');
  });
});

describe('SEC-01 prototype-shaped payloads', () => {
  it.each([
    {
      name: 'constructor.prototype in metadata',
      input: () => ({
        score: wire(score(), [
          '"metadata":{',
          '"metadata":{"constructor":{"prototype":{"polluted":true}},',
        ]),
      }),
      path: ['score', 'metadata', 'constructor'],
    },
    {
      name: '__proto__ in an annotation',
      input: () => ({
        score: wire(score(), ['"id":"a1",', '"id":"a1","__proto__":{"isAdmin":true},']),
      }),
      path: ['score', 'annotations', 0, '__proto__'],
    },
  ])('rejects $name as an unknown field and pollutes nothing', async ({ input, path }) => {
    const { created, create } = harness();

    const error = rejection(await create(input()));

    expect(error.code).toBe('SCORE_VALIDATION_FAILED');
    expect(error.details).toEqual([expect.objectContaining({ code: 'UNKNOWN_FIELD', path })]);
    expect(created).toEqual([]);
    expect(prototypeIsClean()).toBe(true);
  });

  it('rejects __proto__ beside the score in the tool input', async () => {
    const { create } = harness();

    const error = rejection(
      await create(
        wire({ score: score() }, ['{"score":', '{"__proto__":{"polluted":true},"score":']),
      ),
    );

    expect(error.code).toBe('INVALID_INPUT');
    expect(error.details).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_FIELD', path: ['__proto__'] }),
    ]);
    expect(prototypeIsClean()).toBe(true);
  });

  it('never lets __proto__ at the top of the score reach the stored document', async () => {
    const { created, create } = harness();

    const result = await create({
      score: wire(score(), [
        '{"version":1',
        '{"__proto__":{"polluted":true,"annotations":[]},"version":1',
      ]),
    });

    // Observed: the create_score record schema drops this key instead of reporting UNKNOWN_FIELD
    // (see ERRORS_AND_SECURITY.md §4). It must still have no effect at all.
    expect(result.ok).toBe(true);
    const stored = created[0]?.spec;
    expect(stored?.annotations).toHaveLength(1);
    expect(stored === undefined ? true : 'polluted' in stored).toBe(false);
    expect(prototypeIsClean()).toBe(true);
  });

  it('logs a __proto__ key as plain data without touching any prototype', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });

    const fields = wire({ note: 'x', nested: { ok: true } }, [
      '{"note"',
      '{"__proto__":{"polluted":true},"note"',
    ]) as Record<string, unknown>;

    logger.info('input.rejected', fields);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ note: 'x', nested: { ok: true } });
    expect(lines[0]).toContain('"__proto__":{"polluted":true}');
    expect(prototypeIsClean()).toBe(true);
  });
});

describe('SEC-01 no external asset can be named by a request', () => {
  it.each([
    {
      name: 'a SoundFont URL on the score',
      input: () => ({ score: { ...score(), soundfontUrl: 'https://evil.example.test/piano.sf2' } }),
      path: ['score', 'soundfontUrl'],
    },
    {
      name: 'a cover image in the metadata',
      input: () => ({
        score: {
          ...score(),
          metadata: { title: 'x', coverImageUrl: 'https://evil.example.test/a.png' },
        },
      }),
      path: ['score', 'metadata', 'coverImageUrl'],
    },
    {
      name: 'an instrument sample on a staff',
      input: () => {
        const base = score();
        const [staff] = base['staves'] as Record<string, unknown>[];
        return {
          score: {
            ...base,
            staves: [{ ...staff, instrument: { sampleUrl: 'https://evil.example.test/s.wav' } }],
          },
        };
      },
      path: ['score', 'staves', 0, 'instrument'],
    },
    {
      name: 'an asset base URL beside the score',
      input: () => ({ score: score(), assetBaseUrl: 'https://evil.example.test/' }),
      path: ['assetBaseUrl'],
    },
  ])('rejects $name as an unknown field', async ({ input, path }) => {
    const { created, create } = harness();

    const error = rejection(await create(input()));

    expect(error.details).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_FIELD', path }));
    expect(created).toEqual([]);
    expect(JSON.stringify(toHttpError(error).body)).not.toContain('evil.example.test');
  });
});

describe('SEC-01 free-text policy', () => {
  it('keeps markup in annotation text as inert data, byte for byte (renderers escape it)', async () => {
    const { created, create } = harness();
    const text = '<img src=x onerror=alert(1)> see https://evil.example.test';

    expect((await create({ score: score({ text }) })).ok).toBe(true);
    expect(created[0]?.spec.annotations[0]?.text).toBe(text);
  });

  it('rejects over-long text without echoing it in the error', async () => {
    const { create } = harness();
    const title = `<script>alert(1)</script>${'x'.repeat(200)}`;

    const error = rejection(await create({ score: { ...score(), metadata: { title } } }));

    expect(error.details).toEqual([
      expect.objectContaining({ code: 'TEXT_TOO_LONG', path: ['score', 'metadata', 'title'] }),
    ]);
    expect(JSON.stringify(toHttpError(error).body)).not.toContain('<script>');
  });

  it('keeps a forged log entry inside its field: one event, one line', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });
    const forged = 'Root\n{"level":"error","event":"auth.bypassed"}';

    logger.info('annotation.read', { text: forged });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ event: 'annotation.read', text: forged });
  });
});
