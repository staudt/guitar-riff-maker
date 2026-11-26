import { describe, expect, it } from 'vitest';
import { bestPowerRegions, expand, fingerPower, shape } from '../../src/music/powerchord';
import { DROP_D, STANDARD } from '../../src/music/tuning';

describe('shape', () => {
  it('standard E-A pair', () => {
    expect(shape({ string: 0, fret: 5 }, STANDARD, 'r5', 22)).toEqual([
      { string: 0, fret: 5 },
      { string: 1, fret: 7 },
    ]);
  });
  it('G-B pair gets +1 correction', () => {
    expect(shape({ string: 2, fret: 5 }, STANDARD, 'r5', 22)).toEqual([
      { string: 2, fret: 5 },
      { string: 3, fret: 7 },
    ]); // D->G pair: plain +2
    // string 3 (G) root: fifth lands on B, +1 correction
    expect(shape({ string: 3, fret: 5 }, STANDARD, 'r5', 22)).toEqual([
      { string: 3, fret: 5 },
      { string: 4, fret: 8 },
    ]);
  });
  it('r58 adds the octave', () => {
    expect(shape({ string: 0, fret: 3 }, STANDARD, 'r58', 22)).toEqual([
      { string: 0, fret: 3 },
      { string: 1, fret: 5 },
      { string: 2, fret: 5 },
    ]);
    // octave crosses the G-B pair, so it is one fret higher than on other pairs
    expect(shape({ string: 2, fret: 3 }, STANDARD, 'r58', 22)).toEqual([
      { string: 2, fret: 3 },
      { string: 3, fret: 5 },
      { string: 4, fret: 6 },
    ]);
  });
  it('rejects top strings and out-of-range frets', () => {
    expect(shape({ string: 5, fret: 3 }, STANDARD, 'r5', 22)).toBeNull();
    expect(shape({ string: 4, fret: 3 }, STANDARD, 'r58', 22)).toBeNull();
    expect(shape({ string: 0, fret: 21 }, STANDARD, 'r5', 22)).toBeNull();
  });
  it('drop D gives a one-finger shape', () => {
    expect(shape({ string: 0, fret: 3 }, DROP_D, 'r5', 22)).toEqual([
      { string: 0, fret: 3 },
      { string: 1, fret: 3 },
    ]);
  });
});

describe('expand', () => {
  it('lists midi notes', () => {
    expect(expand(40, 'off')).toEqual([40]);
    expect(expand(40, 'r5')).toEqual([40, 47]);
    expect(expand(40, 'r58')).toEqual([40, 47, 52]);
  });
});

describe('fingerPower', () => {
  const notes = [40, 43, 45, 47].map((midi) => ({ midi }));
  it('returns roots with shapes', () => {
    const r = fingerPower(notes, STANDARD, 'r5', { maxFret: 22, target: 0 });
    expect(r.pos).toHaveLength(4);
    r.shapes.forEach((s, i) => {
      expect(s).toHaveLength(2);
      expect(s[0]).toEqual(r.pos[i]);
      expect(STANDARD.strings[s[1]!.string]! + s[1]!.fret).toBe(notes[i]!.midi + 7);
      for (const p of s) if (p.fret > 0) expect(p.fret).toBeGreaterThanOrEqual(r.hands[i]!);
    });
  });
  it('skips notes with no shape', () => {
    const r = fingerPower([{ midi: 90 }, { midi: 40 }], STANDARD, 'r5', { maxFret: 22, target: 0 });
    expect(r.pos[0]).toEqual({ string: -1, fret: -1 });
    expect(r.shapes[0]).toEqual([]);
    expect(r.shapes[1]).toHaveLength(2);
  });
  it('bestPowerRegions gives options', () => {
    const rs = bestPowerRegions(notes, STANDARD, 'r5', { maxFret: 22 });
    expect(rs.length).toBeGreaterThan(0);
    expect(rs[0]!.shapes).toHaveLength(4);
  });
  it('keeps r5 roots on the lowest three strings for A2-A3', () => {
    const riff = [45, 48, 50, 52, 55, 52, 50, 48, 45, 57].map((midi) => ({ midi }));
    for (const target of [5, 9]) {
      const r = fingerPower(riff, STANDARD, 'r5', { maxFret: 22, target });
      expect(r.pos.every((p) => p.string <= 2)).toBe(true);
    }
  });
});
