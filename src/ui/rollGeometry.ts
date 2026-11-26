// Pure geometry for the piano roll: pixel <-> step/row conversions and the visible pitch rows.
import { inScale } from '../music/theory';
import type { Midi, PitchClass, ScaleName } from '../music/types';

export const STEP_W = 24;
export const ROW_H = 28;
export const LABEL_W = 40;
export const MIN_ROWS = 12;
export const DEFAULT_LO = 45; // A2
export const DEFAULT_HI = 57; // A3
export const DRAG_SLOP = 6;
export const LONG_PRESS_MS = 450;

/** Inclusive pitch range shown: notes min-3 .. max+3, at least MIN_ROWS rows, default A2..A3 when empty. */
export function pitchRange(midis: readonly number[]): { lo: Midi; hi: Midi } {
  let lo: number;
  let hi: number;
  if (midis.length === 0) {
    lo = DEFAULT_LO;
    hi = DEFAULT_HI;
  } else {
    lo = Math.min(...midis) - 3;
    hi = Math.max(...midis) + 3;
  }
  let extra = MIN_ROWS - (hi - lo + 1);
  while (extra > 0) {
    if (extra % 2 === 1) hi++;
    else lo--;
    extra--;
  }
  lo = Math.max(0, lo);
  hi = Math.min(127, hi);
  return { lo, hi };
}

/** Row midis, highest first. With snapScale, out-of-key rows are hidden unless a note sits on them. */
export function rowMidis(
  lo: Midi,
  hi: Midi,
  key: { tonic: PitchClass; scale: ScaleName },
  snapScale: boolean,
  noteMidis: readonly number[] = [],
): Midi[] {
  const used = new Set(noteMidis);
  const out: Midi[] = [];
  for (let m = hi; m >= lo; m--) {
    if (!snapScale || used.has(m) || inScale(m, key.tonic, key.scale)) out.push(m);
  }
  return out;
}

export const isCRow = (midi: Midi): boolean => midi % 12 === 0;

export const stepToX = (step: number): number => step * STEP_W;

/** Grid-snapped step (floor) for an x offset inside the grid, clamped to [0, total - unit]. */
export function xToStep(x: number, unit: number, total: number): number {
  const s = Math.floor(x / STEP_W / unit) * unit;
  return Math.max(0, Math.min(total - unit, s));
}

/** Row index (0 = top) for a y offset, clamped to the rows. */
export function yToRow(y: number, rowCount: number): number {
  return Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_H)));
}

/** Snapped step delta for a horizontal pixel drag. */
export const dragStepDelta = (dx: number, unit: number): number => Math.round(dx / STEP_W / unit) * unit;

/** New length when dragging the right edge by dx pixels; snapped to the grid, at least one unit. */
export function resizeLength(step: number, length: number, dx: number, unit: number): number {
  const end = Math.round((step + length + dx / STEP_W) / unit) * unit;
  return Math.max(unit, end - step);
}

/** Midi after dragging a note by dy pixels over the visible rows (stays on a visible row). */
export function dragMidi(rows: readonly Midi[], startMidi: Midi, dy: number): Midi {
  const i = rows.indexOf(startMidi);
  if (i < 0) return startMidi;
  const j = Math.max(0, Math.min(rows.length - 1, i + Math.round(dy / ROW_H)));
  return rows[j] ?? startMidi;
}

/** Ids of notes overlapping the step range [a, b] (either order, b inclusive of the cell). */
export function notesInRange(
  notes: readonly { id: string; step: number; length: number }[],
  a: number,
  b: number,
): string[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return notes.filter((n) => n.step <= hi && n.step + n.length > lo).map((n) => n.id);
}
