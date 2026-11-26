import { describe, expect, it } from 'vitest';
import {
  HIT_RADIUS,
  ROW_H,
  distToBox,
  isDoubleTap,
  isTap,
  nearestNote,
  noteBox,
  tapSlop,
  dragMidi,
  dragStepDelta,
  notesInRange,
  pitchRange,
  resizeLength,
  rowMidis,
  xToStep,
  yToRow,
} from '../../src/ui/rollGeometry';

describe('rollGeometry', () => {
  it('defaults to A2..A3 when empty', () => {
    expect(pitchRange([])).toEqual({ lo: 45, hi: 57 });
  });
  it('pads by 3 and enforces 12 rows', () => {
    const r = pitchRange([60, 62]);
    expect(r.hi - r.lo + 1).toBeGreaterThanOrEqual(12);
    expect(r.lo).toBeLessThanOrEqual(57);
    expect(r.hi).toBeGreaterThanOrEqual(65);
    const wide = pitchRange([40, 70]);
    expect(wide).toEqual({ lo: 37, hi: 73 });
  });
  it('rows are high to low and hide out-of-key when snapping', () => {
    const key = { tonic: 0, scale: 'major' } as const;
    expect(rowMidis(60, 64, key, false)).toEqual([64, 63, 62, 61, 60]);
    expect(rowMidis(60, 64, key, true)).toEqual([64, 62, 60]);
    expect(rowMidis(60, 64, key, true, [61])).toEqual([64, 62, 61, 60]);
  });
  it('converts x to snapped step', () => {
    expect(xToStep(50, 1, 32)).toBe(2);
    expect(xToStep(50, 2, 32)).toBe(2);
    expect(xToStep(75, 2, 32)).toBe(2);
    expect(xToStep(9999, 2, 32)).toBe(30);
    expect(xToStep(-5, 1, 32)).toBe(0);
  });
  it('clamps rows', () => {
    expect(yToRow(0, 5)).toBe(0);
    expect(yToRow(ROW_H + 1, 5)).toBe(1);
    expect(yToRow(9999, 5)).toBe(4);
  });
  it('drag deltas snap', () => {
    expect(dragStepDelta(30, 1)).toBe(1);
    expect(dragStepDelta(30, 2)).toBe(2);
    expect(dragStepDelta(10, 2)).toBe(0);
    expect(resizeLength(0, 2, 24, 1)).toBe(3);
    expect(resizeLength(0, 2, -200, 2)).toBe(2);
    expect(dragMidi([64, 62, 60], 62, 28)).toBe(60);
    expect(dragMidi([64, 62, 60], 62, -999)).toBe(64);
    expect(dragMidi([64, 62, 60], 61, 28)).toBe(61);
  });
  it('selects notes in range', () => {
    const notes = [
      { id: 'a', step: 0, length: 2 },
      { id: 'b', step: 4, length: 2 },
      { id: 'c', step: 8, length: 1 },
    ];
    expect(notesInRange(notes, 5, 1)).toEqual(['a', 'b']);
    expect(notesInRange(notes, 2, 3)).toEqual([]);
  });
});

describe('touch hit testing', () => {
  const a = noteBox({ id: 'a', step: 10, length: 25 }, 2, 2.4); // 60 px wide
  const b = noteBox({ id: 'b', step: 50, length: 25 }, 2, 2.4);
  it('boxes respect the minimum width and row height', () => {
    expect(noteBox({ id: 'x', step: 0, length: 2 }, 0, 2.4).w).toBe(24);
    expect(a.h).toBe(ROW_H - 6);
    expect(a.w).toBeGreaterThanOrEqual(56);
  });
  it('distance is zero inside and euclidean outside', () => {
    expect(distToBox(a, a.x + 5, a.y + 5)).toBe(0);
    expect(distToBox(a, a.x + a.w + 10, a.y + 5)).toBe(10);
    expect(distToBox(a, a.x + a.w + 3, a.y + a.h + 4)).toBe(5);
  });
  it('selects the nearest note within the radius, else none', () => {
    expect(nearestNote([a, b], a.x + 3, a.y + 3)).toBe('a');
    expect(nearestNote([a, b], a.x + a.w + 10, a.y + 10)).toBe('a');
    expect(nearestNote([a, b], a.x + a.w + HIT_RADIUS + 2, a.y + 10)).toBeNull();
    // Between two notes: the nearer wins.
    const gapMid = (a.x + a.w + b.x) / 2;
    expect(nearestNote([a, b], gapMid + 3, a.y + 10, 40)).toBe('b');
    expect(nearestNote([], 0, 0)).toBeNull();
  });
  it('a wobbly, quick touch is a tap; a long press or big move is not', () => {
    expect(tapSlop('touch')).toBeGreaterThanOrEqual(12);
    expect(tapSlop('mouse')).toBeLessThan(tapSlop('touch'));
    expect(isTap(9, 120, 'touch')).toBe(true);
    expect(isTap(13, 120, 'touch')).toBe(false);
    expect(isTap(9, 120, 'mouse')).toBe(false);
    expect(isTap(2, 600, 'touch')).toBe(false);
  });
  it('detects double taps by time and distance', () => {
    const t0 = { t: 1000, x: 100, y: 50 };
    expect(isDoubleTap(null, t0)).toBe(false);
    expect(isDoubleTap(t0, { t: 1300, x: 110, y: 55 })).toBe(true);
    expect(isDoubleTap(t0, { t: 1400, x: 100, y: 50 })).toBe(false);
    expect(isDoubleTap(t0, { t: 1200, x: 140, y: 50 })).toBe(false);
  });
});
