// Key detection (Krumhansl-Schmuckler) and transposition helpers.
import type { DetectedKey, GridNote, RawNote } from './types';
import type { Midi, PitchClass, ScaleName } from '../music/types';
import { SCALES, inScale } from '../music/theory';

// Krumhansl-Kessler key profiles (probe-tone ratings), index 0 = tonic.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Duration-weighted pitch-class histogram. */
export function pitchClassWeights(notes: (RawNote | GridNote)[]): number[] {
  const h = new Array<number>(12).fill(0);
  for (const n of notes) {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    const dur = 'end' in n ? n.end - n.start : n.length;
    h[pc]! += Math.max(0, dur);
  }
  return h;
}

/** Best of the 24 major/minor keys by correlation with the Krumhansl-Kessler profiles. */
export function detectKey(notes: (RawNote | GridNote)[]): DetectedKey {
  const h = pitchClassWeights(notes);
  let best: DetectedKey = { tonic: 0, scale: 'major', score: -Infinity };
  for (let t = 0; t < 12; t++) {
    for (const [scale, prof] of [['major', MAJOR], ['minor', MINOR]] as const) {
      const rot = prof.map((_, i) => prof[(i - t + 12) % 12]!);
      const r = pearson(h, rot);
      if (r > best.score) best = { tonic: t as PitchClass, scale, score: r };
    }
  }
  return best;
}

const isMinorish = (s: ScaleName) => s === 'minor' || s === 'dorian' || s === 'pentatonic';

/**
 * Semitones that move a melody in `from` into the project key by the smallest interval (-6..+5).
 * Mode-aware: a major melody goes to the project's relative major when the project is minor
 * (and vice versa), so its notes stay in the scale.
 */
export function fitInterval(from: DetectedKey, key: PitchClass, scale: ScaleName): number {
  const projectMinor = isMinorish(scale);
  const melodyMinor = from.scale === 'minor';
  let target = key as number;
  if (projectMinor && !melodyMinor) target = (key + 3) % 12; // relative major
  if (!projectMinor && melodyMinor) target = (key + 9) % 12; // relative minor
  let d = (((target - from.tonic) % 12) + 12) % 12;
  if (d > 5) d -= 12;
  return d;
}

/** Shifts by octaves so the melody's median sits as close as possible to `center` (MIDI). */
export function octaveFit(notes: GridNote[], center: Midi): number {
  if (!notes.length) return 0;
  const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  return Math.round((center - med) / 12) * 12;
}

export const transposeChromatic = (notes: GridNote[], semis: number): GridNote[] => notes.map((n) => ({ ...n, midi: n.midi + semis }));

/**
 * Diatonic shift: moves each note `steps` scale degrees within the project scale. Notes outside the
 * scale snap to the nearest scale note below first, so the result is always in key.
 */
export function transposeDiatonic(notes: GridNote[], steps: number, key: PitchClass, scale: ScaleName): GridNote[] {
  const iv = SCALES[scale];
  const len = iv.length;
  return notes.map((n) => {
    // Degree index (with octave) of the nearest scale note at or below n.midi.
    let m = n.midi;
    while (!inScale(m, key, scale)) m--;
    const rel = m - key;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    const deg = iv.indexOf(pc) + oct * len + steps;
    const o2 = Math.floor(deg / len);
    const d2 = ((deg % len) + len) % len;
    return { ...n, midi: key + o2 * 12 + iv[d2]! };
  });
}

export const outOfKey = (notes: GridNote[], key: PitchClass, scale: ScaleName): boolean[] => notes.map((n) => !inScale(n.midi, key, scale));
