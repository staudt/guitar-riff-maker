import { describe, expect, it } from 'vitest';
import {
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
    expect(yToRow(29, 5)).toBe(1);
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
