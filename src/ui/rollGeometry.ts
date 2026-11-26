// Pure geometry for the piano roll: pixel <-> step/row conversions and the visible pitch rows.
import { signal } from '@preact/signals';
import { isFree, type Riff } from '../model/riff';
import { inScale } from '../music/theory';
import type { Midi, PitchClass, ScaleName } from '../music/types';

export const STEP_W = 24;
/** Free riffs: px per 10 ms tick at zoom 1 (about 240 px per second; a 250 ms note is 60 px). */
export const FREE_STEP_W = 2.4;
/** Height of the seconds ruler above the rows (free riffs). */
export const RULER_H = 20;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
/** Horizontal zoom of the roll. */
export const rollZoom = signal(1);

/** Horizontal pixels per step. */
export const pxPerStep = (r: Pick<Riff, 'timing'>, zoom: number): number => (isFree(r) ? FREE_STEP_W : STEP_W) * zoom;

let rollStepX: (step: number) => number = (s) => LABEL_W + s * STEP_W;
/** x (px, within the roll's scrolling surface, label gutter included) of a step. Updated on every render. */
export function getRollStepX(): (step: number) => number {
  return rollStepX;
}
export function setRollStepX(px: number): void {
  rollStepX = (s) => LABEL_W + s * px;
}
export const ROW_H = 36;
/** Visual note box: inset from its row, and never narrower than this. */
export const NOTE_INSET = 3;
export const MIN_NOTE_W = 24;
/** Edge handle (outside the note box): hit area and visible grip. */
export const HANDLE_W = 32;
export const HANDLE_H = 44;
export const LABEL_W = 40;
export const MIN_ROWS = 12;
export const DEFAULT_LO = 45; // A2
export const DEFAULT_HI = 57; // A3
export const DRAG_SLOP = 6;
export const LONG_PRESS_MS = 450;
/** Tap vs drag: a pointer that stays within the slop and lifts within TAP_MAX_MS is a tap. Fingers wobble more than mice. */
export const TAP_SLOP_TOUCH = 12;
export const TAP_SLOP_MOUSE = 5;
export const TAP_MAX_MS = 500;
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_DIST = 30;
/** A tap this close (px) to a note's box selects that note. */
export const HIT_RADIUS = 14;
/** Distance (px) from the recorded line that still counts as tapping it. */
export const TRACE_HIT_RADIUS = 12;

/** Inclusive pitch range shown: min-pad .. max+pad, at least MIN_ROWS rows, default A2..A3 when empty. */
export function pitchRange(midis: readonly number[], pad = 3): { lo: Midi; hi: Midi } {
  let lo: number;
  let hi: number;
  if (midis.length === 0) {
    lo = DEFAULT_LO;
    hi = DEFAULT_HI;
  } else {
    lo = Math.min(...midis) - pad;
    hi = Math.max(...midis) + pad;
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

export const stepToX = (step: number, px = STEP_W): number => step * px;

/** Grid-snapped step (floor) for an x offset inside the grid, clamped to [0, total - unit]. */
export function xToStep(x: number, unit: number, total: number, px = STEP_W): number {
  const s = Math.floor(x / px / unit) * unit;
  return Math.max(0, Math.min(total - unit, s));
}

/** Row index (0 = top) for a y offset, clamped to the rows. */
export function yToRow(y: number, rowCount: number): number {
  return Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_H)));
}

/** Snapped step delta for a horizontal pixel drag. */
export const dragStepDelta = (dx: number, unit: number, px = STEP_W): number => Math.round(dx / px / unit) * unit;

/** New length when dragging the right edge by dx pixels; snapped to the grid, at least one unit. */
export function resizeLength(step: number, length: number, dx: number, unit: number, px = STEP_W): number {
  const end = Math.round((step + length + dx / px) / unit) * unit;
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

/** Fractional row position (0 = centre of the top row) of a fractional midi over the visible rows (highest first). */
export function midiToRowPos(rows: readonly Midi[], m: number): number {
  if (rows.length === 0) return 0;
  if (m >= rows[0]!) return 0;
  const last = rows.length - 1;
  if (m <= rows[last]!) return last;
  for (let i = 0; i < last; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (m <= a && m >= b) return i + (a - m) / (a - b);
  }
  return last;
}

export const tapSlop = (pointerType: string): number => (pointerType === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH);
/** Slop before a selected note starts moving when dragged. */
export const dragSlop = (pointerType: string): number => (pointerType === 'mouse' ? 4 : 10);

/** Tap, as opposed to a drag or a press-and-hold: stayed within the slop (even if it wobbled) and was quick. */
export function isTap(maxDist: number, ms: number, pointerType: string): boolean {
  return maxDist < tapSlop(pointerType) && ms < TAP_MAX_MS;
}

export type TapStamp = { t: number; x: number; y: number };
/** True when `cur` follows `prev` closely in time and place. */
export function isDoubleTap(prev: TapStamp | null, cur: TapStamp): boolean {
  if (!prev) return false;
  const dt = cur.t - prev.t;
  return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) < DOUBLE_TAP_DIST;
}

export type NoteBox = { id: string; x: number; y: number; w: number; h: number };

/** Box of a note in grid coordinates (x from step 0, y from the first row). */
export function noteBox(n: { id: string; step: number; length: number }, rowIndex: number, px: number): NoteBox {
  return { id: n.id, x: n.step * px + 1, y: rowIndex * ROW_H + NOTE_INSET, w: Math.max(MIN_NOTE_W, n.length * px - 2), h: ROW_H - 2 * NOTE_INSET };
}

/** Distance from a point to a box (0 inside). */
export function distToBox(b: NoteBox, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Id of the note whose box is nearest the point, if within `radius` px; ties go to the closer centre. */
export function nearestNote(boxes: readonly NoteBox[], x: number, y: number, radius = HIT_RADIUS): string | null {
  let best: { id: string; d: number; c: number } | null = null;
  for (const b of boxes) {
    const d = distToBox(b, x, y);
    if (d > radius) continue;
    const c = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (!best || d < best.d || (d === best.d && c < best.c)) best = { id: b.id, d, c };
  }
  return best ? best.id : null;
}
