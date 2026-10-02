/**
 * The three scores ChatGPT created through create_score on 2026-10-02 (MCP
 * server in production, ChatGPT developer mode), exported from the drafts
 * table as stored: canonical ScoreSpec v1, so validation returns them
 * unchanged. Chord voicings and changes of an AI reharmonization of a jazz
 * standard; no melody.
 *
 * All three passed domain validation, yet the View in ChatGPT showed
 * "Notation unavailable": the widget sandbox's CSP has no `data:` in
 * `font-src`, so VexFlow's embedded `url(data:...)` fonts never loaded and
 * every render failed with RENDER_FAILED. Kept as regression fixtures of the
 * renderer under that CSP (renderer-vexflow REN-I03, REN-04).
 */
import type { ScoreSpecInput } from '@sheet-music/music-domain';
import { frozen } from './builders';

/**
 * Sixteen bars, two staves: whole-note voicings over a bass note (bars 1-8),
 * the same reharmonized (9-16, enharmonic spellings such as E#5 and A#4), a
 * split final bar; no harmony and no other label.
 */
export const CHATGPT_STELLA_16: ScoreSpecInput = frozen({
  id: 'scr_792af668-41d0-4272-9d0d-3376af7b6a05',
  tempo: { bpm: 72 },
  staves: [
    {
      id: 'rh',
      clef: 'treble',
      hand: 'right',
      measures: [
        {
          id: 'm1',
          number: 1,
          voices: [
            {
              id: 'r1v',
              events: [
                {
                  id: 'r1c',
                  type: 'chord',
                  notes: [
                    { id: 'r1a', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'r1b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r1d', pitch: { step: 'B', alter: -1, octave: 4 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          number: 2,
          voices: [
            {
              id: 'r2v',
              events: [
                {
                  id: 'r2c',
                  type: 'chord',
                  notes: [
                    { id: 'r2a', pitch: { step: 'C', alter: 1, octave: 4 } },
                    { id: 'r2b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r2d', pitch: { step: 'B', alter: -1, octave: 4 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          number: 3,
          voices: [
            {
              id: 'r3v',
              events: [
                {
                  id: 'r3c',
                  type: 'chord',
                  notes: [
                    { id: 'r3a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'r3b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r3d', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r3e', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          number: 4,
          voices: [
            {
              id: 'r4v',
              events: [
                {
                  id: 'r4c',
                  type: 'chord',
                  notes: [
                    { id: 'r4a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'r4b', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'r4d', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          number: 5,
          voices: [
            {
              id: 'r5v',
              events: [
                {
                  id: 'r5c',
                  type: 'chord',
                  notes: [
                    { id: 'r5a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'r5b', pitch: { step: 'A', alter: -1, octave: 4 } },
                    { id: 'r5d', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'r5e', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          number: 6,
          voices: [
            {
              id: 'r6v',
              events: [
                {
                  id: 'r6c',
                  type: 'chord',
                  notes: [
                    { id: 'r6a', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'r6b', pitch: { step: 'A', alter: -1, octave: 4 } },
                    { id: 'r6d', pitch: { step: 'C', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          number: 7,
          voices: [
            {
              id: 'r7v',
              events: [
                {
                  id: 'r7c',
                  type: 'chord',
                  notes: [
                    { id: 'r7a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r7b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r7d', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'r7e', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          number: 8,
          voices: [
            {
              id: 'r8v',
              events: [
                {
                  id: 'r8c',
                  type: 'chord',
                  notes: [
                    { id: 'r8a', pitch: { step: 'C', alter: 0, octave: 4 } },
                    { id: 'r8b', pitch: { step: 'G', alter: -1, octave: 4 } },
                    { id: 'r8d', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r8e', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm9',
          number: 9,
          voices: [
            {
              id: 'r9v',
              events: [
                {
                  id: 'r9c',
                  type: 'chord',
                  notes: [
                    { id: 'r9a', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'r9b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r9d', pitch: { step: 'B', alter: -1, octave: 4 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm10',
          number: 10,
          voices: [
            {
              id: 'r10v',
              events: [
                {
                  id: 'r10c',
                  type: 'chord',
                  notes: [
                    { id: 'r10a', pitch: { step: 'D', alter: -1, octave: 4 } },
                    { id: 'r10b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r10d', pitch: { step: 'A', alter: 0, octave: 4 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm11',
          number: 11,
          voices: [
            {
              id: 'r11v',
              events: [
                {
                  id: 'r11c',
                  type: 'chord',
                  notes: [
                    { id: 'r11a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'r11b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r11d', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r11e', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm12',
          number: 12,
          voices: [
            {
              id: 'r12v',
              events: [
                {
                  id: 'r12c',
                  type: 'chord',
                  notes: [
                    { id: 'r12a', pitch: { step: 'D', alter: 1, octave: 4 } },
                    { id: 'r12b', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'r12d', pitch: { step: 'E', alter: 1, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm13',
          number: 13,
          voices: [
            {
              id: 'r13v',
              events: [
                {
                  id: 'r13c',
                  type: 'chord',
                  notes: [
                    { id: 'r13a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'r13b', pitch: { step: 'A', alter: -1, octave: 4 } },
                    { id: 'r13d', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'r13e', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm14',
          number: 14,
          voices: [
            {
              id: 'r14v',
              events: [
                {
                  id: 'r14c',
                  type: 'chord',
                  notes: [
                    { id: 'r14a', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'r14b', pitch: { step: 'G', alter: 1, octave: 4 } },
                    { id: 'r14d', pitch: { step: 'A', alter: 1, octave: 4 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm15',
          number: 15,
          voices: [
            {
              id: 'r15v',
              events: [
                {
                  id: 'r15c',
                  type: 'chord',
                  notes: [
                    { id: 'r15a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'r15b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r15d', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'r15e', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm16',
          number: 16,
          voices: [
            {
              id: 'r16v',
              events: [
                {
                  id: 'r16c1',
                  type: 'chord',
                  notes: [
                    { id: 'r16a', pitch: { step: 'D', alter: -1, octave: 4 } },
                    { id: 'r16b', pitch: { step: 'G', alter: -1, octave: 4 } },
                    { id: 'r16d', pitch: { step: 'B', alter: -1, octave: 4 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'r16c2',
                  type: 'chord',
                  notes: [
                    { id: 'r16e', pitch: { step: 'C', alter: 0, octave: 4 } },
                    { id: 'r16f', pitch: { step: 'G', alter: -1, octave: 4 } },
                    { id: 'r16g', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'r16h', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'lh',
      clef: 'bass',
      hand: 'left',
      measures: [
        {
          id: 'm1',
          number: 1,
          voices: [
            {
              id: 'l1v',
              events: [
                {
                  id: 'l1n',
                  type: 'note',
                  pitch: { step: 'E', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          number: 2,
          voices: [
            {
              id: 'l2v',
              events: [
                {
                  id: 'l2n',
                  type: 'note',
                  pitch: { step: 'A', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          number: 3,
          voices: [
            {
              id: 'l3v',
              events: [
                {
                  id: 'l3n',
                  type: 'note',
                  pitch: { step: 'C', alter: 0, octave: 3 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          number: 4,
          voices: [
            {
              id: 'l4v',
              events: [
                {
                  id: 'l4n',
                  type: 'note',
                  pitch: { step: 'F', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          number: 5,
          voices: [
            {
              id: 'l5v',
              events: [
                {
                  id: 'l5n',
                  type: 'note',
                  pitch: { step: 'F', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          number: 6,
          voices: [
            {
              id: 'l6v',
              events: [
                {
                  id: 'l6n',
                  type: 'note',
                  pitch: { step: 'B', alter: -1, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          number: 7,
          voices: [
            {
              id: 'l7v',
              events: [
                {
                  id: 'l7n',
                  type: 'note',
                  pitch: { step: 'E', alter: -1, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          number: 8,
          voices: [
            {
              id: 'l8v',
              events: [
                {
                  id: 'l8n',
                  type: 'note',
                  pitch: { step: 'A', alter: -1, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm9',
          number: 9,
          voices: [
            {
              id: 'l9v',
              events: [
                {
                  id: 'l9n',
                  type: 'note',
                  pitch: { step: 'E', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm10',
          number: 10,
          voices: [
            {
              id: 'l10v',
              events: [
                {
                  id: 'l10n',
                  type: 'note',
                  pitch: { step: 'E', alter: -1, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm11',
          number: 11,
          voices: [
            {
              id: 'l11v',
              events: [
                {
                  id: 'l11n',
                  type: 'note',
                  pitch: { step: 'C', alter: 0, octave: 3 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm12',
          number: 12,
          voices: [
            {
              id: 'l12v',
              events: [
                {
                  id: 'l12n',
                  type: 'note',
                  pitch: { step: 'B', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm13',
          number: 13,
          voices: [
            {
              id: 'l13v',
              events: [
                {
                  id: 'l13n',
                  type: 'note',
                  pitch: { step: 'F', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm14',
          number: 14,
          voices: [
            {
              id: 'l14v',
              events: [
                {
                  id: 'l14n',
                  type: 'note',
                  pitch: { step: 'E', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm15',
          number: 15,
          voices: [
            {
              id: 'l15v',
              events: [
                {
                  id: 'l15n',
                  type: 'note',
                  pitch: { step: 'E', alter: -1, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          id: 'm16',
          number: 16,
          voices: [
            {
              id: 'l16v',
              events: [
                {
                  id: 'l16n1',
                  type: 'note',
                  pitch: { step: 'E', alter: -1, octave: 2 },
                  duration: { value: 'half' },
                },
                {
                  id: 'l16n2',
                  type: 'note',
                  pitch: { step: 'A', alter: -1, octave: 2 },
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  version: 1,
  metadata: {
    tags: ['jazz', 'reharmonisation'],
    title: 'Stella by Starlight – original (1-8) puis réharmonisation (9-16)',
  },
  revision: 1,
  annotations: [],
  keySignature: { fifths: -2 },
  timeSignature: { numerator: 4, denominator: 4 },
});

/**
 * Eight bars, two staves, chords only (four-note right-hand voicings,
 * left-hand shells, half notes): 16 chord symbols with display text
 * ("Em7♭5", "A7alt"), two per bar, under a "Medium swing" feel.
 */
export const CHATGPT_STELLA_REHARM_A: ScoreSpecInput = frozen({
  id: 'scr_8eca3ab6-a070-4d28-9004-f6e580c49134',
  tempo: { bpm: 76 },
  staves: [
    {
      id: 'RH',
      clef: 'treble',
      hand: 'right',
      measures: [
        {
          id: 'm1',
          kind: 'full',
          number: 1,
          voices: [
            {
              id: 'rhv1',
              events: [
                {
                  id: 'm1r1',
                  type: 'chord',
                  notes: [
                    { id: 'm1r1a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm1r1b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm1r1c', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm1r1d', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm1r2',
                  type: 'chord',
                  notes: [
                    { id: 'm1r2a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm1r2b', pitch: { step: 'C', alter: 1, octave: 5 } },
                    { id: 'm1r2c', pitch: { step: 'F', alter: 0, octave: 5 } },
                    { id: 'm1r2d', pitch: { step: 'B', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          kind: 'full',
          number: 2,
          voices: [
            {
              id: 'rhv2',
              events: [
                {
                  id: 'm2r1',
                  type: 'chord',
                  notes: [
                    { id: 'm2r1a', pitch: { step: 'G', alter: -1, octave: 4 } },
                    { id: 'm2r1b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm2r1c', pitch: { step: 'D', alter: -1, octave: 5 } },
                    { id: 'm2r1d', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm2r2',
                  type: 'chord',
                  notes: [
                    { id: 'm2r2a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm2r2b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm2r2c', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm2r2d', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          kind: 'full',
          number: 3,
          voices: [
            {
              id: 'rhv3',
              events: [
                {
                  id: 'm3r1',
                  type: 'chord',
                  notes: [
                    { id: 'm3r1a', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm3r1b', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm3r1c', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm3r1d', pitch: { step: 'E', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm3r2',
                  type: 'chord',
                  notes: [
                    { id: 'm3r2a', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm3r2b', pitch: { step: 'B', alter: 0, octave: 4 } },
                    { id: 'm3r2c', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm3r2d', pitch: { step: 'A', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          kind: 'full',
          number: 4,
          voices: [
            {
              id: 'rhv4',
              events: [
                {
                  id: 'm4r1',
                  type: 'chord',
                  notes: [
                    { id: 'm4r1a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm4r1b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm4r1c', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm4r1d', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm4r2',
                  type: 'chord',
                  notes: [
                    { id: 'm4r2a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm4r2b', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm4r2c', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm4r2d', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          kind: 'full',
          number: 5,
          voices: [
            {
              id: 'rhv5',
              events: [
                {
                  id: 'm5r1',
                  type: 'chord',
                  notes: [
                    { id: 'm5r1a', pitch: { step: 'A', alter: -1, octave: 4 } },
                    { id: 'm5r1b', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm5r1c', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm5r1d', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm5r2',
                  type: 'chord',
                  notes: [
                    { id: 'm5r2a', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm5r2b', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm5r2c', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm5r2d', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          kind: 'full',
          number: 6,
          voices: [
            {
              id: 'rhv6',
              events: [
                {
                  id: 'm6r1',
                  type: 'chord',
                  notes: [
                    { id: 'm6r1a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm6r1b', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm6r1c', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm6r1d', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm6r2',
                  type: 'chord',
                  notes: [
                    { id: 'm6r2a', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm6r2b', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm6r2c', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm6r2d', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          kind: 'full',
          number: 7,
          voices: [
            {
              id: 'rhv7',
              events: [
                {
                  id: 'm7r1',
                  type: 'chord',
                  notes: [
                    { id: 'm7r1a', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm7r1b', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm7r1c', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm7r1d', pitch: { step: 'E', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm7r2',
                  type: 'chord',
                  notes: [
                    { id: 'm7r2a', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm7r2b', pitch: { step: 'B', alter: 0, octave: 4 } },
                    { id: 'm7r2c', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm7r2d', pitch: { step: 'A', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          kind: 'full',
          number: 8,
          voices: [
            {
              id: 'rhv8',
              events: [
                {
                  id: 'm8r1',
                  type: 'chord',
                  notes: [
                    { id: 'm8r1a', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm8r1b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm8r1c', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm8r1d', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm8r2',
                  type: 'chord',
                  notes: [
                    { id: 'm8r2a', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'm8r2b', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm8r2c', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm8r2d', pitch: { step: 'E', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'LH',
      clef: 'bass',
      hand: 'left',
      measures: [
        {
          id: 'm1',
          kind: 'full',
          number: 1,
          voices: [
            {
              id: 'lhv1',
              events: [
                {
                  id: 'm1l1',
                  type: 'chord',
                  notes: [
                    { id: 'm1l1a', pitch: { step: 'E', alter: 0, octave: 2 } },
                    { id: 'm1l1b', pitch: { step: 'D', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm1l2',
                  type: 'chord',
                  notes: [
                    { id: 'm1l2a', pitch: { step: 'A', alter: 0, octave: 2 } },
                    { id: 'm1l2b', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          kind: 'full',
          number: 2,
          voices: [
            {
              id: 'lhv2',
              events: [
                {
                  id: 'm2l1',
                  type: 'chord',
                  notes: [
                    { id: 'm2l1a', pitch: { step: 'E', alter: -1, octave: 2 } },
                    { id: 'm2l1b', pitch: { step: 'D', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm2l2',
                  type: 'chord',
                  notes: [
                    { id: 'm2l2a', pitch: { step: 'A', alter: -1, octave: 2 } },
                    { id: 'm2l2b', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          kind: 'full',
          number: 3,
          voices: [
            {
              id: 'lhv3',
              events: [
                {
                  id: 'm3l1',
                  type: 'chord',
                  notes: [
                    { id: 'm3l1a', pitch: { step: 'D', alter: 0, octave: 2 } },
                    { id: 'm3l1b', pitch: { step: 'C', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm3l2',
                  type: 'chord',
                  notes: [
                    { id: 'm3l2a', pitch: { step: 'G', alter: 0, octave: 2 } },
                    { id: 'm3l2b', pitch: { step: 'F', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          kind: 'full',
          number: 4,
          voices: [
            {
              id: 'lhv4',
              events: [
                {
                  id: 'm4l1',
                  type: 'chord',
                  notes: [
                    { id: 'm4l1a', pitch: { step: 'C', alter: 0, octave: 2 } },
                    { id: 'm4l1b', pitch: { step: 'B', alter: -1, octave: 2 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm4l2',
                  type: 'chord',
                  notes: [
                    { id: 'm4l2a', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm4l2b', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          kind: 'full',
          number: 5,
          voices: [
            {
              id: 'lhv5',
              events: [
                {
                  id: 'm5l1',
                  type: 'chord',
                  notes: [
                    { id: 'm5l1a', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm5l1b', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm5l2',
                  type: 'chord',
                  notes: [
                    { id: 'm5l2a', pitch: { step: 'B', alter: -1, octave: 2 } },
                    { id: 'm5l2b', pitch: { step: 'A', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          kind: 'full',
          number: 6,
          voices: [
            {
              id: 'lhv6',
              events: [
                {
                  id: 'm6l1',
                  type: 'chord',
                  notes: [
                    { id: 'm6l1a', pitch: { step: 'E', alter: -1, octave: 2 } },
                    { id: 'm6l1b', pitch: { step: 'D', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm6l2',
                  type: 'chord',
                  notes: [
                    { id: 'm6l2a', pitch: { step: 'A', alter: -1, octave: 2 } },
                    { id: 'm6l2b', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          kind: 'full',
          number: 7,
          voices: [
            {
              id: 'lhv7',
              events: [
                {
                  id: 'm7l1',
                  type: 'chord',
                  notes: [
                    { id: 'm7l1a', pitch: { step: 'D', alter: 0, octave: 2 } },
                    { id: 'm7l1b', pitch: { step: 'C', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm7l2',
                  type: 'chord',
                  notes: [
                    { id: 'm7l2a', pitch: { step: 'D', alter: -1, octave: 2 } },
                    { id: 'm7l2b', pitch: { step: 'C', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          kind: 'full',
          number: 8,
          voices: [
            {
              id: 'lhv8',
              events: [
                {
                  id: 'm8l1',
                  type: 'chord',
                  notes: [
                    { id: 'm8l1a', pitch: { step: 'C', alter: 0, octave: 2 } },
                    { id: 'm8l1b', pitch: { step: 'B', alter: -1, octave: 2 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm8l2',
                  type: 'chord',
                  notes: [
                    { id: 'm8l2a', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm8l2b', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  harmony: [
    {
      id: 'h1a',
      chord: {
        root: { step: 'E', alter: 0 },
        display: 'Em7♭5',
        quality: 'half-diminished',
        extension: 7,
      },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm1',
    },
    {
      id: 'h1b',
      chord: { root: { step: 'A', alter: 0 }, display: 'A7alt', quality: 'dominant', extension: 7 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm1',
    },
    {
      id: 'h2a',
      chord: { root: { step: 'E', alter: -1 }, display: 'E♭m9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm2',
    },
    {
      id: 'h2b',
      chord: {
        root: { step: 'A', alter: -1 },
        display: 'A♭13',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm2',
    },
    {
      id: 'h3a',
      chord: { root: { step: 'D', alter: 0 }, display: 'Dm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm3',
    },
    {
      id: 'h3b',
      chord: { root: { step: 'G', alter: 0 }, display: 'G7alt', quality: 'dominant', extension: 7 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm3',
    },
    {
      id: 'h4a',
      chord: { root: { step: 'C', alter: 0 }, display: 'Cm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm4',
    },
    {
      id: 'h4b',
      chord: {
        root: { step: 'F', alter: 0 },
        display: 'F13sus',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm4',
    },
    {
      id: 'h5a',
      chord: { root: { step: 'F', alter: 0 }, display: 'Fm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm5',
    },
    {
      id: 'h5b',
      chord: {
        root: { step: 'B', alter: -1 },
        display: 'B♭13',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm5',
    },
    {
      id: 'h6a',
      chord: { root: { step: 'E', alter: -1 }, display: 'E♭maj9', quality: 'major', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm6',
    },
    {
      id: 'h6b',
      chord: {
        root: { step: 'A', alter: -1 },
        display: 'A♭13♯11',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm6',
    },
    {
      id: 'h7a',
      chord: { root: { step: 'D', alter: 0 }, display: 'Dm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm7',
    },
    {
      id: 'h7b',
      chord: {
        root: { step: 'D', alter: -1 },
        display: 'D♭7♯11',
        quality: 'dominant',
        extension: 7,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm7',
    },
    {
      id: 'h8a',
      chord: { root: { step: 'C', alter: 0 }, display: 'Cm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm8',
    },
    {
      id: 'h8b',
      chord: { root: { step: 'F', alter: 0 }, display: 'F13', quality: 'dominant', extension: 13 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm8',
    },
  ],
  version: 1,
  metadata: {
    tags: ['jazz', 'reharmonisation', 'piano'],
    title: 'Stella by Starlight — reharm moderne (8 mesures, sans mélodie)',
  },
  revision: 1,
  annotations: [],
  keySignature: { fifths: -2 },
  playbackFeel: {
    type: 'swing',
    ratio: { long: 2, short: 1 },
    displayText: 'Medium swing',
    subdivision: 'eighth',
  },
  tonalContext: { mode: 'major', tonic: { step: 'B', alter: -1 } },
  timeSignature: { numerator: 4, denominator: 4 },
});

/**
 * A second take of the same request: eight bars, chords only, 16 chord
 * symbols with display text, swing feel.
 */
export const CHATGPT_STELLA_REHARM_B: ScoreSpecInput = frozen({
  id: 'scr_51c3b3a1-f2e5-4f02-a6d5-e93068a42b95',
  tempo: { bpm: 76 },
  staves: [
    {
      id: 'RH',
      clef: 'treble',
      hand: 'right',
      measures: [
        {
          id: 'm1',
          kind: 'full',
          number: 1,
          voices: [
            {
              id: 'rh1',
              events: [
                {
                  id: 'm1rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm1rh1n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm1rh1n2', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm1rh1n3', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm1rh1n4', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm1rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm1rh2n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm1rh2n2', pitch: { step: 'C', alter: 1, octave: 5 } },
                    { id: 'm1rh2n3', pitch: { step: 'F', alter: 0, octave: 5 } },
                    { id: 'm1rh2n4', pitch: { step: 'B', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          kind: 'full',
          number: 2,
          voices: [
            {
              id: 'rh2',
              events: [
                {
                  id: 'm2rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm2rh1n1', pitch: { step: 'G', alter: -1, octave: 4 } },
                    { id: 'm2rh1n2', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm2rh1n3', pitch: { step: 'D', alter: -1, octave: 5 } },
                    { id: 'm2rh1n4', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm2rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm2rh2n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm2rh2n2', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm2rh2n3', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm2rh2n4', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          kind: 'full',
          number: 3,
          voices: [
            {
              id: 'rh3',
              events: [
                {
                  id: 'm3rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm3rh1n1', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm3rh1n2', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm3rh1n3', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm3rh1n4', pitch: { step: 'E', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm3rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm3rh2n1', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm3rh2n2', pitch: { step: 'B', alter: 0, octave: 4 } },
                    { id: 'm3rh2n3', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm3rh2n4', pitch: { step: 'A', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          kind: 'full',
          number: 4,
          voices: [
            {
              id: 'rh4',
              events: [
                {
                  id: 'm4rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm4rh1n1', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm4rh1n2', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm4rh1n3', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm4rh1n4', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm4rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm4rh2n1', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm4rh2n2', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm4rh2n3', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm4rh2n4', pitch: { step: 'G', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          kind: 'full',
          number: 5,
          voices: [
            {
              id: 'rh5',
              events: [
                {
                  id: 'm5rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm5rh1n1', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm5rh1n2', pitch: { step: 'A', alter: -1, octave: 4 } },
                    { id: 'm5rh1n3', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm5rh1n4', pitch: { step: 'E', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm5rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm5rh2n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm5rh2n2', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm5rh2n3', pitch: { step: 'E', alter: -1, octave: 5 } },
                    { id: 'm5rh2n4', pitch: { step: 'A', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          kind: 'full',
          number: 6,
          voices: [
            {
              id: 'rh6',
              events: [
                {
                  id: 'm6rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm6rh1n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm6rh1n2', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm6rh1n3', pitch: { step: 'D', alter: 0, octave: 5 } },
                    { id: 'm6rh1n4', pitch: { step: 'F', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm6rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm6rh2n1', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm6rh2n2', pitch: { step: 'C', alter: 1, octave: 5 } },
                    { id: 'm6rh2n3', pitch: { step: 'F', alter: 0, octave: 5 } },
                    { id: 'm6rh2n4', pitch: { step: 'B', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          kind: 'full',
          number: 7,
          voices: [
            {
              id: 'rh7',
              events: [
                {
                  id: 'm7rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm7rh1n1', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm7rh1n2', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm7rh1n3', pitch: { step: 'C', alter: 0, octave: 5 } },
                    { id: 'm7rh1n4', pitch: { step: 'E', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm7rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm7rh2n1', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm7rh2n2', pitch: { step: 'B', alter: 0, octave: 4 } },
                    { id: 'm7rh2n3', pitch: { step: 'E', alter: 0, octave: 5 } },
                    { id: 'm7rh2n4', pitch: { step: 'A', alter: -1, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          kind: 'full',
          number: 8,
          voices: [
            {
              id: 'rh8',
              events: [
                {
                  id: 'm8rh1',
                  type: 'chord',
                  notes: [
                    { id: 'm8rh1n1', pitch: { step: 'E', alter: -1, octave: 4 } },
                    { id: 'm8rh1n2', pitch: { step: 'G', alter: 0, octave: 4 } },
                    { id: 'm8rh1n3', pitch: { step: 'B', alter: -1, octave: 4 } },
                    { id: 'm8rh1n4', pitch: { step: 'D', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm8rh2',
                  type: 'chord',
                  notes: [
                    { id: 'm8rh2n1', pitch: { step: 'D', alter: 0, octave: 4 } },
                    { id: 'm8rh2n2', pitch: { step: 'F', alter: 0, octave: 4 } },
                    { id: 'm8rh2n3', pitch: { step: 'A', alter: 0, octave: 4 } },
                    { id: 'm8rh2n4', pitch: { step: 'C', alter: 0, octave: 5 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'LH',
      clef: 'bass',
      hand: 'left',
      measures: [
        {
          id: 'm1',
          kind: 'full',
          number: 1,
          voices: [
            {
              id: 'lh1',
              events: [
                {
                  id: 'm1lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm1lh1n1', pitch: { step: 'E', alter: 0, octave: 2 } },
                    { id: 'm1lh1n2', pitch: { step: 'D', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm1lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm1lh2n1', pitch: { step: 'A', alter: 0, octave: 2 } },
                    { id: 'm1lh2n2', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm2',
          kind: 'full',
          number: 2,
          voices: [
            {
              id: 'lh2',
              events: [
                {
                  id: 'm2lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm2lh1n1', pitch: { step: 'E', alter: -1, octave: 2 } },
                    { id: 'm2lh1n2', pitch: { step: 'D', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm2lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm2lh2n1', pitch: { step: 'A', alter: -1, octave: 2 } },
                    { id: 'm2lh2n2', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm3',
          kind: 'full',
          number: 3,
          voices: [
            {
              id: 'lh3',
              events: [
                {
                  id: 'm3lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm3lh1n1', pitch: { step: 'D', alter: 0, octave: 2 } },
                    { id: 'm3lh1n2', pitch: { step: 'C', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm3lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm3lh2n1', pitch: { step: 'G', alter: 0, octave: 2 } },
                    { id: 'm3lh2n2', pitch: { step: 'F', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm4',
          kind: 'full',
          number: 4,
          voices: [
            {
              id: 'lh4',
              events: [
                {
                  id: 'm4lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm4lh1n1', pitch: { step: 'C', alter: 0, octave: 2 } },
                    { id: 'm4lh1n2', pitch: { step: 'B', alter: -1, octave: 2 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm4lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm4lh2n1', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm4lh2n2', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm5',
          kind: 'full',
          number: 5,
          voices: [
            {
              id: 'lh5',
              events: [
                {
                  id: 'm5lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm5lh1n1', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm5lh1n2', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm5lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm5lh2n1', pitch: { step: 'B', alter: -1, octave: 2 } },
                    { id: 'm5lh2n2', pitch: { step: 'A', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm6',
          kind: 'full',
          number: 6,
          voices: [
            {
              id: 'lh6',
              events: [
                {
                  id: 'm6lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm6lh1n1', pitch: { step: 'E', alter: -1, octave: 2 } },
                    { id: 'm6lh1n2', pitch: { step: 'D', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm6lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm6lh2n1', pitch: { step: 'A', alter: -1, octave: 2 } },
                    { id: 'm6lh2n2', pitch: { step: 'G', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm7',
          kind: 'full',
          number: 7,
          voices: [
            {
              id: 'lh7',
              events: [
                {
                  id: 'm7lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm7lh1n1', pitch: { step: 'D', alter: 0, octave: 2 } },
                    { id: 'm7lh1n2', pitch: { step: 'C', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm7lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm7lh2n1', pitch: { step: 'D', alter: -1, octave: 2 } },
                    { id: 'm7lh2n2', pitch: { step: 'C', alter: 0, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
        {
          id: 'm8',
          kind: 'full',
          number: 8,
          voices: [
            {
              id: 'lh8',
              events: [
                {
                  id: 'm8lh1',
                  type: 'chord',
                  notes: [
                    { id: 'm8lh1n1', pitch: { step: 'C', alter: 0, octave: 2 } },
                    { id: 'm8lh1n2', pitch: { step: 'B', alter: -1, octave: 2 } },
                  ],
                  duration: { value: 'half' },
                },
                {
                  id: 'm8lh2',
                  type: 'chord',
                  notes: [
                    { id: 'm8lh2n1', pitch: { step: 'F', alter: 0, octave: 2 } },
                    { id: 'm8lh2n2', pitch: { step: 'E', alter: -1, octave: 3 } },
                  ],
                  duration: { value: 'half' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  harmony: [
    {
      id: 'h1a',
      chord: {
        root: { step: 'E', alter: 0 },
        display: 'Em7♭5',
        quality: 'half-diminished',
        extension: 7,
      },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm1',
    },
    {
      id: 'h1b',
      chord: { root: { step: 'A', alter: 0 }, display: 'A7alt', quality: 'dominant', extension: 7 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm1',
    },
    {
      id: 'h2a',
      chord: { root: { step: 'E', alter: -1 }, display: 'E♭m9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm2',
    },
    {
      id: 'h2b',
      chord: {
        root: { step: 'A', alter: -1 },
        display: 'A♭13',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm2',
    },
    {
      id: 'h3a',
      chord: { root: { step: 'D', alter: 0 }, display: 'Dm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm3',
    },
    {
      id: 'h3b',
      chord: { root: { step: 'G', alter: 0 }, display: 'G7alt', quality: 'dominant', extension: 7 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm3',
    },
    {
      id: 'h4a',
      chord: { root: { step: 'C', alter: 0 }, display: 'Cm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm4',
    },
    {
      id: 'h4b',
      chord: {
        root: { step: 'F', alter: 0 },
        display: 'F13sus',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm4',
    },
    {
      id: 'h5a',
      chord: { root: { step: 'F', alter: 0 }, display: 'Fm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm5',
    },
    {
      id: 'h5b',
      chord: {
        root: { step: 'B', alter: -1 },
        display: 'B♭13',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm5',
    },
    {
      id: 'h6a',
      chord: { root: { step: 'E', alter: -1 }, display: 'E♭maj9', quality: 'major', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm6',
    },
    {
      id: 'h6b',
      chord: {
        root: { step: 'A', alter: -1 },
        display: 'A♭13♯11',
        quality: 'dominant',
        extension: 13,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm6',
    },
    {
      id: 'h7a',
      chord: { root: { step: 'D', alter: 0 }, display: 'Dm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm7',
    },
    {
      id: 'h7b',
      chord: {
        root: { step: 'D', alter: -1 },
        display: 'D♭7♯11',
        quality: 'dominant',
        extension: 7,
      },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm7',
    },
    {
      id: 'h8a',
      chord: { root: { step: 'C', alter: 0 }, display: 'Cm9', quality: 'minor', extension: 9 },
      offset: { numerator: 0, denominator: 1 },
      measureId: 'm8',
    },
    {
      id: 'h8b',
      chord: { root: { step: 'F', alter: 0 }, display: 'F13', quality: 'dominant', extension: 13 },
      offset: { numerator: 1, denominator: 2 },
      measureId: 'm8',
    },
  ],
  version: 1,
  metadata: {
    tags: ['jazz', 'reharmonisation', 'piano', 'Stella by Starlight'],
    title: 'Stella by Starlight — réharmonisation moderne (8 mesures, sans mélodie)',
  },
  revision: 1,
  annotations: [],
  keySignature: { fifths: -2 },
  playbackFeel: {
    type: 'swing',
    ratio: { long: 2, short: 1 },
    displayText: 'Medium swing',
    subdivision: 'eighth',
  },
  tonalContext: { mode: 'major', tonic: { step: 'B', alter: -1 } },
  timeSignature: { numerator: 4, denominator: 4 },
});
