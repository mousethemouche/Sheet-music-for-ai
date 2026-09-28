/**
 * Small helpers shared by the SPEC-01..07 tests. They only read results and
 * edit copies of fixture JSON; the behavior under test is always the real
 * @sheet-music/music-domain module.
 */
import {
  type DomainError,
  type ErrorPath,
  type Fraction,
  type ScoreSpecInput,
  validateScoreSpec,
} from '@sheet-music/music-domain';
import { type EventInput, type MeasureInput, type VoiceInput, cloneFixture } from '../src/builders';

export { parseFixture as accepted } from '../src/parse';

/** Validates input that must be rejected and returns the structured error. */
export function rejected(input: unknown): DomainError {
  const result = validateScoreSpec(input);
  if (result.ok) {
    throw new Error('Expected validateScoreSpec to reject the input, but it was accepted.');
  }
  return result.error;
}

export interface DetailSummary {
  readonly code: string;
  readonly path: ErrorPath;
  readonly ids?: readonly string[];
}

/** The error without its prose messages, for exact comparisons. */
export function summarize(error: DomainError): { code: string; details: DetailSummary[] } {
  return {
    code: error.code,
    details: error.details.map(({ code, path, ids }) =>
      ids === undefined ? { code, path } : { code, path, ids },
    ),
  };
}

/** Code and path of every detail (ids ignored). */
export function codesAndPaths(error: DomainError): { code: string; path: ErrorPath }[] {
  return error.details.map(({ code, path }) => ({ code, path }));
}

/** A mutable copy of `fixture` changed by `edit`; the frozen fixture itself is untouched. */
export function variant(
  fixture: ScoreSpecInput,
  edit: (draft: ScoreSpecInput) => void,
): ScoreSpecInput {
  const draft = cloneFixture(fixture);
  edit(draft);
  return draft;
}

export function at<T>(items: readonly T[] | undefined, index: number): T {
  const item = items?.[index];
  if (item === undefined) {
    throw new Error(`No item at index ${index}`);
  }
  return item;
}

export function measureAt(draft: ScoreSpecInput, staff: number, measure: number): MeasureInput {
  return at(at(draft.staves, staff).measures, measure);
}

export function voiceAt(
  draft: ScoreSpecInput,
  staff: number,
  measure: number,
  voice: number,
): VoiceInput {
  return at(measureAt(draft, staff, measure).voices, voice);
}

export function eventAt(
  draft: ScoreSpecInput,
  staff: number,
  measure: number,
  voice: number,
  event: number,
): EventInput {
  return at(voiceAt(draft, staff, measure, voice).events, event);
}

/** JSON path of an event, as validation reports it. */
export function eventPath(staff: number, measure: number, voice: number, event: number): ErrorPath {
  return ['staves', staff, 'measures', measure, 'voices', voice, 'events', event];
}

/** Whole-note fraction to PPQ-960 ticks (3840 per whole note); throws if not a whole number of ticks. */
export function toTicks(value: Fraction): number {
  const ticks = (value.numerator * 3840) / value.denominator;
  if (!Number.isInteger(ticks)) {
    throw new Error(`${value.numerator}/${value.denominator} is not a whole number of ticks`);
  }
  return ticks;
}

/** Parses an oracle fraction string such as "29/28". */
export function parseFraction(text: string): Fraction {
  const [numerator, denominator] = text.split('/').map(Number);
  return { numerator: numerator ?? Number.NaN, denominator: denominator ?? Number.NaN };
}
