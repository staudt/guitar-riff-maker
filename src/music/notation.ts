// Note names <-> MIDI (C4 = 60). Subset of groovebox store/notation.ts.
import type { Midi } from './types';

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Note name to MIDI (C4 = 60). Returns null if not a note name. */
export function noteToMidi(name: string): Midi | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const base = LETTER[m[1]!]!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function midiToNote(midi: Midi, flats = true): string {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return (flats ? NAMES_FLAT : NAMES_SHARP)[pc]! + oct;
}
