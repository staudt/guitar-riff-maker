// Pure geometry for the neck view. All x values are in SVG user units of the main neck <svg>.
import type { Pos } from '../music/types';

export const NECK_W = 360;
export const NECK_H = 138;
/** Fretted area (left = nut side, before mirroring). */
export const BOARD_L = 40;
export const BOARD_R = NECK_W - 10;
export const STRING_TOP = 16;
export const STRING_BOTTOM = 98;
export const LABEL_Y = 124;
export const VISIBLE_FRETS = 7;
export const MAX_WINDOW = 12;

export type FretWindow = { start: number; end: number };

/** Visible fret window (inclusive note frets). Default is 7 frets from anchor-1; widened (up to 12) to cover all notes. */
export function windowFor(anchor: number, positions: readonly Pos[], maxFret: number): FretWindow {
  const startMax = Math.max(0, maxFret - (VISIBLE_FRETS - 1));
  const start = Math.min(Math.max(anchor - 1, 0), startMax);
  const base = { start, end: Math.min(start + VISIBLE_FRETS - 1, Math.max(maxFret, VISIBLE_FRETS - 1)) };
  let lo = base.start;
  let hi = base.end;
  for (const p of positions) {
    if (p.fret < 0 || p.string < 0) continue;
    lo = Math.min(lo, p.fret);
    hi = Math.max(hi, p.fret);
  }
  if (lo === base.start && hi === base.end) return base;
  if (hi - lo + 1 <= MAX_WINDOW) return { start: lo, end: hi };
  return base;
}

/** First wire drawn: the nut when the window starts at fret 0/1, else the wire just left of the first fret. */
export const wireLo = (w: FretWindow) => Math.max(w.start - 1, 0);

const pos12 = (f: number) => 1 - Math.pow(2, -f / 12);

/** x of fret wire `f` (wire f is the right edge of fret f). Realistic spacing, rescaled to fill the window. */
export function fretX(f: number, w: FretWindow, left = BOARD_L, right = BOARD_R): number {
  const lo = wireLo(w);
  const a = pos12(lo);
  const b = pos12(w.end);
  return left + ((pos12(f) - a) / (b - a)) * (right - left);
}

/** x of a note at `fret` (centre between wires; open strings sit left of the nut). */
export function noteX(fret: number, w: FretWindow): number {
  if (fret <= 0) return BOARD_L - 14;
  return (fretX(fret - 1, w) + fretX(fret, w)) / 2;
}

/** y of a string (0 = lowest). lowBottom draws the lowest string at the bottom. */
export function stringY(string: number, count: number, lowBottom: boolean, top = STRING_TOP, bottom = STRING_BOTTOM): number {
  const row = lowBottom ? count - 1 - string : string;
  return top + (count <= 1 ? 0 : (row * (bottom - top)) / (count - 1));
}

/** Mirror an x about the vertical centre of a drawing of width W. */
export const mirrorX = (x: number, W: number = NECK_W) => W - x;

/** Final point of a position in the neck svg, after optional left-hand mirroring. */
export function pointFor(pos: Pos, w: FretWindow, count: number, lowBottom: boolean, mirror: boolean): { x: number; y: number } {
  const x = noteX(pos.fret, w);
  return { x: mirror ? mirrorX(x) : x, y: stringY(pos.string, count, lowBottom) };
}

/** Fret numbers with inlay dots; 12 is double. */
export const INLAYS: readonly number[] = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
