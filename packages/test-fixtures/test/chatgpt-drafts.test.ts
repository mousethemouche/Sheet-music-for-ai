/**
 * The ChatGPT production drafts are regression fixtures of valid input: each
 * is a canonical ScoreSpec v1, so validation accepts it and returns it field
 * for field (what the server stored is what the View received).
 */
import { validateScoreSpec } from '@sheet-music/music-domain';
import { describe, expect, it } from 'vitest';
import { CHATGPT_STELLA_16, CHATGPT_STELLA_REHARM_A, CHATGPT_STELLA_REHARM_B } from '../src';

describe('ChatGPT production drafts', () => {
  it.each([
    { name: 'CHATGPT_STELLA_16', draft: CHATGPT_STELLA_16 },
    { name: 'CHATGPT_STELLA_REHARM_A', draft: CHATGPT_STELLA_REHARM_A },
    { name: 'CHATGPT_STELLA_REHARM_B', draft: CHATGPT_STELLA_REHARM_B },
  ])('$name is a canonical ScoreSpec, returned unchanged by validation', ({ draft }) => {
    expect(validateScoreSpec(draft)).toEqual({ ok: true, value: draft });
  });
});
