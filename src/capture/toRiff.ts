// Transcription -> Riff: quantize, fit the melody into guitar range, detect the key.
import { quantize } from './notes';
import { detectKey, octaveFit } from './key';
import type { RawNote, Transcription } from './types';
import { newId, newRiff, type Bars, type GridSize, type PowerMode, type Riff } from '../model/riff';

export type ToRiffOpts = {
  bpm: number;
  bars: 1 | 2 | 4;
  grid: GridSize;
  power: PowerMode;
  /** Lowest open string, MIDI (40 in standard tuning). */
  tuningLow: number;
  base?: Partial<Riff>;
};

/** Highest pitch we try to keep notes under (about fret 22 of the high e string). */
export const MAX_MIDI = 86;

export function defaultName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Riff ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toRiff(trans: Transcription, opts: ToRiffOpts): Riff {
  const { bpm, bars, grid, power, tuningLow, base } = opts;
  const grid0 = quantize(trans.notes, bpm, grid, bars * 16);
  const center = power === 'off' ? 55 : 45;
  let shift = octaveFit(grid0, center);
  if (grid0.length) {
    const lo = () => Math.min(...grid0.map((n) => n.midi)) + shift;
    const hi = () => Math.max(...grid0.map((n) => n.midi)) + shift;
    while (lo() < tuningLow) shift += 12;
    // Come down only if the melody still fits above the low string afterwards.
    while (hi() > MAX_MIDI && lo() - 12 >= tuningLow) shift -= 12;
  }
  const notes = grid0.map((n) => ({
    id: newId(),
    step: n.step,
    length: n.length,
    midi: n.midi + shift,
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
  }));
  const key = grid0.length ? detectKey(notes) : { tonic: 9 as const, scale: 'minor' as const };
  const raw: RawNote[] = trans.notes.map((n) => ({ ...n, midi: n.midi + shift }));
  return newRiff({
    name: defaultName(),
    ...base,
    bpm,
    bars: bars as Bars,
    grid,
    power,
    key: { tonic: key.tonic, scale: key.scale },
    notes,
    capture: { raw, bpm },
  });
}
