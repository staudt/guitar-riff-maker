// Scales and chords in the project key. Pure functions; used by the keyboard, pickers and notation.
import type { Midi, PitchClass, ScaleName } from './types';

export const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10], // minor pentatonic
};

const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const pcName = (pc: number, flats = true) => (flats ? PC_FLAT : PC_SHARP)[((pc % 12) + 12) % 12]!;

/** Pitch classes of the scale, in order from the key. */
export function scalePcs(key: PitchClass, scale: ScaleName): number[] {
  return SCALES[scale].map((i) => (key + i) % 12);
}

export function inScale(midi: Midi, key: PitchClass, scale: ScaleName): boolean {
  return scalePcs(key, scale).includes(((midi % 12) + 12) % 12);
}

/** MIDI notes of the scale starting at `root` (a MIDI note of the key) going up `count` degrees. */
export function scaleNotes(rootMidi: Midi, scale: ScaleName, count: number): Midi[] {
  const iv = SCALES[scale];
  const out: Midi[] = [];
  for (let k = 0; k < count; k++) out.push(rootMidi + iv[k % iv.length]! + 12 * Math.floor(k / iv.length));
  return out;
}

/** Chord qualities: suffix -> intervals from the root. */
const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

/** Parses a chord symbol like "Fm", "Bb7", "C#maj7". Returns the root pitch class and intervals. */
export function parseChord(symbol: string): { root: number; intervals: number[] } | null {
  const m = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  if (!m) return null;
  const intervals = QUALITIES[m[3]!];
  if (!intervals) return null;
  const root = (LETTER[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { root, intervals };
}

/** Close-position voicing with the root in the octave starting at `baseMidi` (default C3 = 48). */
export function chordNotes(symbol: string, baseMidi: Midi = 48): Midi[] {
  const c = parseChord(symbol);
  if (!c) return [];
  return c.intervals.map((i) => baseMidi + c.root + i);
}

/**
 * Diatonic chords of the key (triads, or sevenths with `sevenths`), one per scale degree.
 * Pentatonic falls back to its parent natural minor for chord building.
 */
export function diatonicChords(key: PitchClass, scale: ScaleName, sevenths = false): { symbol: string; degree: number }[] {
  const iv = SCALES[scale === 'pentatonic' ? 'minor' : scale];
  const out: { symbol: string; degree: number }[] = [];
  for (let d = 0; d < 7; d++) {
    const at = (k: number) => (iv[(d + k) % 7]! + 12 * Math.floor((d + k) / 7) - iv[d]!) % 24;
    const third = at(2);
    const fifth = at(4);
    const seventh = at(6);
    let q = third === 4 ? (fifth === 8 ? 'aug' : '') : fifth === 6 ? 'dim' : 'm';
    if (sevenths) {
      if (q === '') q = seventh === 11 ? 'maj7' : '7';
      else if (q === 'm') q = 'm7';
      else if (q === 'dim') q = seventh === 10 ? 'm7b5' : 'dim7';
    }
    out.push({ symbol: pcName(key + iv[d]!) + q, degree: d + 1 });
  }
  return out;
}
