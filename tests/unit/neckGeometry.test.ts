import { describe, expect, it } from 'vitest';
import { fretX, mirrorX, noteX, pointFor, stringY, windowFor, NECK_W } from '../../src/ui/neckGeometry';

describe('windowFor', () => {
  it('starts one fret before the anchor, 7 frets wide', () => {
    expect(windowFor(5, [], 22)).toEqual({ start: 4, end: 10 });
  });
  it('clamps at both ends', () => {
    expect(windowFor(0, [], 22)).toEqual({ start: 0, end: 6 });
    expect(windowFor(30, [], 22)).toEqual({ start: 16, end: 22 });
  });
  it('extends to cover notes up to 12 frets', () => {
    expect(windowFor(5, [{ string: 0, fret: 2 }, { string: 1, fret: 12 }], 22)).toEqual({ start: 2, end: 12 });
  });
  it('falls back when notes span more than 12 frets', () => {
    expect(windowFor(5, [{ string: 0, fret: 0 }, { string: 1, fret: 15 }], 22)).toEqual({ start: 4, end: 10 });
  });
  it('ignores unplayable positions', () => {
    expect(windowFor(5, [{ string: -1, fret: -1 }], 22)).toEqual({ start: 4, end: 10 });
  });
});

describe('geometry', () => {
  it('mirror maps x to W - x', () => {
    expect(mirrorX(10)).toBe(NECK_W - 10);
    expect(mirrorX(mirrorX(77))).toBe(77);
  });
  it('fret spacing is monotonic decreasing', () => {
    const w = { start: 0, end: 12 };
    let prev = Infinity;
    for (let f = 1; f <= 12; f++) {
      const d = fretX(f, w) - fretX(f - 1, w);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });
  it('open notes sit left of the nut', () => {
    const w = { start: 0, end: 6 };
    expect(noteX(0, w)).toBeLessThan(fretX(0, w));
    expect(noteX(1, w)).toBeGreaterThan(fretX(0, w));
  });
  it('stringY flips with lowBottom', () => {
    expect(stringY(0, 6, true)).toBeGreaterThan(stringY(5, 6, true));
    expect(stringY(0, 6, false)).toBeLessThan(stringY(5, 6, false));
  });
  it('pointFor mirrors x only', () => {
    const w = { start: 0, end: 6 };
    const a = pointFor({ string: 2, fret: 3 }, w, 6, true, false);
    const b = pointFor({ string: 2, fret: 3 }, w, 6, true, true);
    expect(b.x).toBeCloseTo(NECK_W - a.x);
    expect(b.y).toBe(a.y);
  });
});
