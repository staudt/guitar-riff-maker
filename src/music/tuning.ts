// Guitar tunings and string naming.
import { pcName } from './theory';
import type { Midi, Tuning } from './types';

export const STANDARD: Tuning = { name: 'Standard', strings: [40, 45, 50, 55, 59, 64] };
export const DROP_D: Tuning = { name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] };
export const HALF_DOWN: Tuning = { name: 'Half step down', strings: STANDARD.strings.map((m) => m - 1) };

export const TUNINGS: readonly Tuning[] = [STANDARD, DROP_D, HALF_DOWN];

/** Display name of string `i` (0 = lowest). The highest string is lowercase when it shares its name with the lowest. */
export function stringName(t: Tuning, i: number): string {
  const m = t.strings[i];
  if (m === undefined) return '?';
  const name = pcName(m);
  const low = t.strings[0];
  if (i === t.strings.length - 1 && i > 0 && low !== undefined && pcName(low) === name) return name.toLowerCase();
  return name;
}

/** Lowest and highest playable MIDI notes with frets 0..maxFret. */
export function rangeOf(t: Tuning, maxFret: number): [Midi, Midi] {
  const lo = t.strings[0] ?? 0;
  const hi = (t.strings[t.strings.length - 1] ?? 0) + maxFret;
  return [lo, hi];
}
