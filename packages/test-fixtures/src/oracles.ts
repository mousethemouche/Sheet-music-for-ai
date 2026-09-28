/**
 * Independent expected values for the fixture catalogue (TEST_PLAN §4),
 * written by hand as plain data. They are NOT computed by music-domain code,
 * so tests in #2 (positions), #5 (mapping) and #6 (ticks, MIDI, swing) can use
 * them as oracles. Ticks use PPQ 960 (a whole note is 3840 ticks); keys are
 * MIDI numbers with middle C4 = 60.
 */
import { frozen } from './builders';

export const PPQ = 960;
export const TICKS_PER_WHOLE_NOTE = 3840;

export const F01_ORACLE = frozen({
  noteIds: ['f01-n1', 'f01-n2', 'f01-n3', 'f01-n4'],
  startTicks: [0, 960, 1920, 2880],
  durationTicks: [960, 960, 960, 960],
  keys: [60, 62, 64, 65],
  totalTicks: 3840,
  /** Tempo is in quarter notes per minute: at 120, one quarter lasts 0.5 s. */
  bpm: 120,
  quarterSeconds: 0.5,
});

export const F02_ORACLE = frozen({
  barIds: ['f02-m1', 'f02-m2'],
  eventStartTicks: {
    'f02-c1': 0,
    'f02-rh-n1': 1920,
    'f02-rh-n2': 2880,
    'f02-rh-n3': 3840,
    'f02-lh-n1': 0,
    'f02-lh-n2': 960,
    'f02-lh-n3': 1920,
    'f02-lh-n4': 3840,
  },
  chordId: 'f02-c1',
  chordMemberIds: ['f02-c1-c', 'f02-c1-e', 'f02-c1-g'],
  chordMemberKeys: [60, 64, 67],
  chordDurationTicks: 1920,
  totalTicks: 7680,
});

export const F03_ORACLE = frozen({
  harmony: [
    { id: 'f03-h1', measureId: 'f03-m1', offsetTicks: 0, display: 'Dm7', romanNumeral: 'ii7' },
    { id: 'f03-h2', measureId: 'f03-m1', offsetTicks: 1920, display: 'G7(b9)', romanNumeral: 'V7' },
    { id: 'f03-h3', measureId: 'f03-m2', offsetTicks: 0, display: 'Cmaj7', romanNumeral: 'Imaj7' },
  ],
  chordKeys: {
    'f03-lh-c1': [50, 53, 57, 60],
    'f03-lh-c2': [43, 47, 50, 53],
    'f03-lh-c3': [48, 52, 55, 59],
  },
  scaleDegrees: {
    'f03-rh-n1': 4,
    'f03-rh-n2': 3,
    'f03-rh-n3': 2,
    'f03-rh-n4': 7,
    'f03-rh-n5': 1,
  },
  totalTicks: 7680,
});

export const F04_ORACLE = frozen({
  barIds: ['f04-m1', 'f04-m2', 'f04-m3'],
  meters: ['7/4', '6/8', '7/4'],
  barStartTicks: [0, 6720, 9600],
  barDurationTicks: [6720, 2880, 6720],
  totalTicks: 16320,
});

export const F05_ORACLE = frozen({
  sharpNoteId: 'f05-fs',
  flatNoteId: 'f05-gb',
  writtenSpellings: { 'f05-fs': 'F#4', 'f05-gb': 'Gb4' },
  /** Both spellings sound the same piano key. */
  key: 66,
  scaleDegreeDisplays: { 'f05-fs': '#4', 'f05-gb': 'b5' },
});

export const F06_ORACLE = frozen({
  triplet: {
    groupId: 'f06-t1',
    noteIds: ['f06-n1', 'f06-n2', 'f06-n3'],
    startTicks: [0, 320, 640],
    memberTicks: 320,
    totalTicks: 960,
  },
  quintuplet: {
    groupId: 'f06-q1',
    noteIds: ['f06-n4', 'f06-n5', 'f06-n6', 'f06-n7', 'f06-n8'],
    startTicks: [960, 1344, 1728, 2112, 2496],
    memberTicks: 384,
    totalTicks: 1920,
  },
  quarterAfterTupletsStartTicks: 2880,
  /** 7:4 sixteenths are 1/28 of a whole note: not a whole number of ticks at PPQ 960. */
  septuplet: {
    groupId: 'f06-s1',
    noteIds: ['f06-n10', 'f06-n11', 'f06-n12', 'f06-n13', 'f06-n14', 'f06-n15', 'f06-n16'],
    memberWholeNotes: '1/28',
    startWholeNotes: ['1/1', '29/28', '15/14', '31/28', '8/7', '33/28', '17/14'],
    totalTicks: 960,
  },
  dottedHalfAfterSeptupletStartTicks: 4800,
  totalTicks: 7680,
});

export const F07_ORACLE = frozen({
  barIds: ['f07-m1', 'f07-m2', 'f07-m3'],
  barStartTicks: [0, 960, 4800],
  barDurationTicks: [960, 3840, 2880],
  pickupTicks: 960,
  totalTicks: 7680,
});

export const F08_ORACLE = frozen({
  slurIds: ['f08-s1', 'f08-s2'],
  tiePairs: [['f08-rh-n9', 'f08-rh-n10']],
  /** Same pitches in bars 1 and 2: slurred first, unmarked second. */
  legatoPair: {
    slurredNoteIds: ['f08-rh-n1', 'f08-rh-n2', 'f08-rh-n3', 'f08-rh-n4'],
    unmarkedNoteIds: ['f08-rh-n5', 'f08-rh-n6', 'f08-rh-n7', 'f08-rh-n8'],
    keys: [60, 62, 64, 65],
  },
  /** Slurred repeated pitch that is not tied: two attacks. */
  repeatedPitchSlur: { slurId: 'f08-s2', noteIds: ['f08-rh-n10', 'f08-rh-n11'], key: 67 },
  articulations: {
    'f08-rh-n9': ['accent'],
    'f08-rh-n12': ['accent'],
    'f08-rh-n13': ['staccato'],
    'f08-rh-n14': ['tenuto'],
    'f08-rh-n15': ['marcato'],
  },
  fingerings: { 'f08-rh-n1': 1, 'f08-rh-n2': 2, 'f08-rh-n3': 3, 'f08-rh-n4': 4 },
  dynamicMarks: [
    { id: 'f08-d1', eventId: 'f08-rh-n1', marking: 'p', startTick: 0 },
    { id: 'f08-d3', eventId: 'f08-rh-n12', marking: 'f', startTick: 11520 },
  ],
  hairpins: [
    { id: 'f08-d2', direction: 'crescendo', startTick: 0, endTick: 3840 },
    { id: 'f08-d4', direction: 'diminuendo', startTick: 11520, endTick: 15360 },
  ],
  pedalSpans: [
    { id: 'f08-p1', startTick: 7680, endTick: 11520 },
    { id: 'f08-p2', startTick: 11520, endTick: 15360 },
  ],
  totalTicks: 15360,
});

export const F09_ORACLE = frozen({
  annotationId: 'f09-a1',
  canonicalColor: '#ff69b4',
  noteIds: ['f09-n1', 'f09-n2', 'f09-n3'],
  unannotatedNoteIds: ['f09-n4'],
  text: 'C major triad: root, third and fifth',
  conflict: { noteId: 'f09-n3', annotationIds: ['f09-a1', 'f09-a2'] },
});

export const F10_ORACLE = frozen({
  noteIds: ['f10-n1', 'f10-n2', 'f10-n3', 'f10-n4', 'f10-n5', 'f10-n6', 'f10-n7', 'f10-n8'],
  straightStartTicks: [0, 480, 960, 1440, 1920, 2400, 2880, 3360],
  /** Swing requested without ratio (P-02 default) and explicit 2:1 give the same starts. */
  swing2to1StartTicks: [0, 640, 960, 1600, 1920, 2560, 2880, 3520],
  swing3to2StartTicks: [0, 576, 960, 1536, 1920, 2496, 2880, 3456],
  totalTicks: 3840,
});

export const RICH_WIRE_ORACLE = frozen({
  staffIds: ['rich-rh', 'rich-lh'],
  barIds: ['rich-m1', 'rich-m2', 'rich-m3', 'rich-m4'],
  barStartTicks: [0, 960, 4800, 7680],
  barDurationTicks: [960, 3840, 2880, 2880],
  voiceIds: [
    'rich-rh-m1-v1',
    'rich-rh-m2-v1',
    'rich-rh-m3-v1',
    'rich-rh-m4-v1',
    'rich-lh-m1-v1',
    'rich-lh-m2-v1',
    'rich-lh-m3-v1',
    'rich-lh-m4-v1',
  ],
  eventIds: [
    'rich-rh-n1',
    'rich-rh-n2',
    'rich-rh-c1',
    'rich-rh-n3',
    'rich-rh-n4',
    'rich-rh-n5',
    'rich-rh-n6',
    'rich-rh-n7',
    'rich-rh-n8',
    'rich-rh-n9',
    'rich-rh-c2',
    'rich-lh-r1',
    'rich-lh-n1',
    'rich-lh-n2',
    'rich-lh-n3',
    'rich-lh-n4',
    'rich-lh-n5',
  ],
  chordMemberIds: ['rich-rh-c1-g', 'rich-rh-c1-b', 'rich-rh-c1-d', 'rich-rh-c2-g', 'rich-rh-c2-b'],
  tupletGroupIds: ['rich-t1'],
  harmonyIds: ['rich-h1', 'rich-h2', 'rich-h3', 'rich-h4'],
  slurIds: ['rich-s1'],
  dynamicIds: ['rich-d1', 'rich-d2', 'rich-d3', 'rich-d4'],
  pedalIds: ['rich-p1'],
  scaleDegreeIds: ['rich-sd1', 'rich-sd2', 'rich-sd3', 'rich-sd4'],
  annotationIds: ['rich-a1', 'rich-a2'],
  tiePairs: [['rich-rh-c1-d', 'rich-rh-n3']],
  /** The colored, fingered chord member. */
  coloredChordMember: { id: 'rich-rh-c1-b', chordId: 'rich-rh-c1', fingering: 3, color: '#e91e63' },
  totalTicks: 10560,
});
