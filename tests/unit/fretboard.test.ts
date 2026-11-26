import { describe, expect, it } from 'vitest';
import { alternatives, bestRegions, COST, fingerRiff, handWindow, positionsFor } from '../../src/music/fretboard';
import { STANDARD } from '../../src/music/tuning';

const BOX = [45, 48, 50, 52, 55, 57].map((midi) => ({ midi }));
const opt = { maxFret: 22 };

describe('positionsFor', () => {
  it('finds all places for E4', () => {
    const ps = positionsFor(64, STANDARD, 22);
    expect(ps).toHaveLength(5);
    for (const p of [
      { string: 5, fret: 0 },
      { string: 4, fret: 5 },
      { string: 3, fret: 9 },
      { string: 2, fret: 14 },
      { string: 1, fret: 19 },
    ])
      expect(ps).toContainEqual(p);
  });
  it('respects maxFret and range', () => {
    expect(positionsFor(64, STANDARD, 12)).toHaveLength(3);
    expect(positionsFor(30, STANDARD, 22)).toEqual([]);
  });
  it('alternatives exclude current', () => {
    const alts = alternatives(64, STANDARD, 22, { string: 5, fret: 0 });
    expect(alts).toHaveLength(4);
    expect(alts).not.toContainEqual({ string: 5, fret: 0 });
  });
});

describe('fingerRiff', () => {
  it('empty riff', () => {
    expect(fingerRiff([], STANDARD, { ...opt, target: 5 })).toEqual({ pos: [], hands: [], cost: 0 });
  });
  it('keeps the A minor box in one position at target 5', () => {
    const r = fingerRiff(BOX, STANDARD, { ...opt, target: 5 });
    expect(r.pos.every((p) => p.fret >= 5 && p.fret <= 8)).toBe(true);
    expect(new Set(r.hands).size).toBe(1);
    expect(r.hands[0]).toBe(5);
  });
  it('uses open strings at target 0', () => {
    const r = fingerRiff(BOX, STANDARD, { ...opt, target: 0 });
    expect(r.pos.some((p) => p.fret === 0)).toBe(true);
  });
  it('respects pins', () => {
    const notes = BOX.map((n, i) => (i === 2 ? { ...n, pin: { string: 2, fret: 0 } } : n));
    const r = fingerRiff(notes, STANDARD, { ...opt, target: 5 });
    expect(r.pos[2]).toEqual({ string: 2, fret: 0 });
  });
  it('falls back to free when the pin is wrong', () => {
    const r = fingerRiff([{ midi: 50, pin: { string: 0, fret: 1 } }], STANDARD, { ...opt, target: 5 });
    expect(r.pos[0]).toEqual({ string: 1, fret: 5 });
  });
  it('shifts the hand when a line is wider than the window', () => {
    // Single string run, frets 5..12 on low E.
    const notes = [5, 6, 7, 8, 9, 10, 11, 12].map((f) => ({ midi: 40 + f, pin: { string: 0, fret: f } }));
    const r = fingerRiff(notes, STANDARD, { ...opt, target: 5 });
    r.pos.forEach((p, i) => {
      expect(p.fret).toBeGreaterThanOrEqual(r.hands[i]!);
      expect(p.fret).toBeLessThanOrEqual(r.hands[i]! + 3);
    });
    const shifts = r.hands.filter((h, i) => i > 0 && h !== r.hands[i - 1]).length;
    expect(shifts).toBeGreaterThanOrEqual(1);
  });
  it('shifts exactly once for a 5-fret spread', () => {
    const notes = [5, 7, 9, 10].map((f) => ({ midi: 40 + f, pin: { string: 0, fret: f } }));
    const r = fingerRiff(notes, STANDARD, { ...opt, target: 5 });
    expect(r.hands.filter((h, i) => i > 0 && h !== r.hands[i - 1])).toHaveLength(1);
  });
  it('marks notes outside the range as unplayable', () => {
    const r = fingerRiff([{ midi: 45 }, { midi: 20 }, { midi: 100 }, { midi: 47 }], STANDARD, { ...opt, target: 3 });
    expect(r.pos[1]).toEqual({ string: -1, fret: -1 });
    expect(r.pos[2]).toEqual({ string: -1, fret: -1 });
    expect(r.pos[0]!.fret).toBeGreaterThanOrEqual(0);
    expect(r.hands.every((h) => h >= 1)).toBe(true);
  });
  it('all-unplayable riff does not crash', () => {
    const r = fingerRiff([{ midi: 10 }], STANDARD, { ...opt, target: 3 });
    expect(r.pos).toEqual([{ string: -1, fret: -1 }]);
    expect(r.hands).toHaveLength(1);
  });
  it('is fast for 64 timed notes (with triad pair-states)', () => {
    const notes = Array.from({ length: 64 }, (_, i) => ({ midi: 45 + ((i * 7) % 24), start: i * 0.15, end: i * 0.15 + 0.15 }));
    let best = Infinity;
    for (let k = 0; k < 15; k++) {
      const t = performance.now();
      fingerRiff(notes, STANDARD, { ...opt, target: 5 });
      best = Math.min(best, performance.now() - t);
    }
    // Typically ~1-3 ms; the generous bound only guards against accidental blow-ups on slow CI.
    expect(best).toBeLessThan(100);
  });
  it('exposes COST', () => {
    expect(COST.wShift).toBeGreaterThan(0);
  });
});

describe('bestRegions', () => {
  it('returns distinct options sorted by anchor, at most k', () => {
    const rs = bestRegions(BOX, STANDARD, { ...opt, k: 4 });
    expect(rs.length).toBeGreaterThan(1);
    expect(rs.length).toBeLessThanOrEqual(4);
    const keys = rs.map((r) => JSON.stringify(r.pos));
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < rs.length; i++) expect(rs[i]!.anchor).toBeGreaterThanOrEqual(rs[i - 1]!.anchor);
    for (const r of rs) expect(r.pos.map((p) => STANDARD.strings[p.string]! + p.fret)).toEqual(BOX.map((n) => n.midi));
  });
  it('handWindow', () => {
    expect(handWindow([5, 7], 1)).toEqual([7, 10]);
  });

  const DEMO = [45, 48, 50, 52, 55, 52, 50, 48, 45, 45, 48, 50, 52, 55, 57].map((midi) => ({ midi }));
  it('offers the 5th-position box as an option', () => {
    const rs = bestRegions(DEMO, STANDARD, opt);
    expect(rs.some((r) => r.pos.every((p) => p.fret >= 5 && p.fret <= 8) && new Set(r.hands).size === 1)).toBe(true);
  });
  it('anchors are spread by at least 3 frets', () => {
    const rs = bestRegions(DEMO, STANDARD, opt);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(Math.abs(rs[i]!.anchor - rs[j]!.anchor)).toBeGreaterThanOrEqual(3);
  });
  it('high regions avoid open strings', () => {
    const rs = bestRegions(DEMO, STANDARD, opt).filter((r) => r.anchor >= 5);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.pos.some((p) => p.fret === 0)).toBe(false);
  });
});

/** Notes at a steady `ioi` seconds apart, each lasting `dur` (default: legato). */
const timed = (midis: number[], ioi: number, dur = ioi) => midis.map((midi, i) => ({ midi, start: i * ioi, end: i * ioi + dur }));
const shifts = (hands: number[]) => hands.filter((h, i) => i > 0 && h !== hands[i - 1]).length;

describe('string changes beat hand shifts', () => {
  // The demo melody at 96 bpm, 16ths = 0.15 s.
  const DEMO_T = timed([45, 48, 50, 52, 55, 52, 50, 48, 45, 45, 48, 50, 52, 55, 57], 0.3);

  it('low region plays G3 as the open G string, not D:5 (changed: used to slide along the D string)', () => {
    const r = fingerRiff(DEMO_T, STANDARD, { ...opt, target: 1 });
    expect(r.pos[4]).toEqual({ string: 3, fret: 0 });
    expect(r.pos.every((p) => p.fret >= 0 && p.fret <= 3)).toBe(true);
    expect(shifts(r.hands)).toBe(0);
  });

  it('5th position keeps the box on strings E/A/D', () => {
    const r = fingerRiff(DEMO_T, STANDARD, { ...opt, target: 5 });
    expect(r.pos.every((p) => p.fret >= 5 && p.fret <= 8 && p.string <= 2)).toBe(true);
    expect(shifts(r.hands)).toBe(0);
  });

  it('a fast 7-fret melodic range stays in one position, using several strings', () => {
    const r = fingerRiff(timed([50, 52, 54, 55, 57, 59, 57, 55, 54, 52, 50], 0.1), STANDARD, { ...opt, target: 0 });
    expect(shifts(r.hands)).toBe(0);
    expect(new Set(r.pos.map((p) => p.string)).size).toBeGreaterThanOrEqual(2);
    const fretted = r.pos.filter((p) => p.fret > 0).map((p) => p.fret);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
  });

  it('a forced shift is much cheaper after a rest than in a fast passage', () => {
    // Pinned on the low E string: frets 1-3, then frets 9-11. The hand has to travel either way.
    const pins = [1, 2, 3, 9, 10, 11].map((f) => ({ midi: 40 + f, pin: { string: 0, fret: f } }));
    const fast = fingerRiff(pins.map((n, i) => ({ ...n, start: i * 0.1, end: i * 0.1 + 0.1 })), STANDARD, { ...opt, target: 1 });
    const rest = fingerRiff(pins.map((n, i) => ({ ...n, start: i * 0.1 + (i >= 3 ? 1 : 0), end: i * 0.1 + 0.1 + (i >= 3 ? 1 : 0) })), STANDARD, { ...opt, target: 1 });
    expect(shifts(fast.hands)).toBe(1);
    expect(shifts(rest.hands)).toBe(1);
    expect(rest.cost).toBeLessThan(fast.cost * 0.6);
  });

  it('an A-minor arpeggio played fast lands on adjacent strings in a small span', () => {
    const r = fingerRiff(timed([45, 48, 52, 57], 0.12), STANDARD, { ...opt, target: 2 });
    const fr = r.pos.map((p) => p.fret);
    expect(Math.max(...fr) - Math.min(...fr)).toBeLessThanOrEqual(3);
    for (let i = 1; i < r.pos.length; i++) expect(Math.abs(r.pos[i]!.string - r.pos[i - 1]!.string)).toBeLessThanOrEqual(1);
    expect(shifts(r.hands)).toBe(0);
  });

  it('never jumps more than 3 frets along one string when another string is inside the window', () => {
    for (const midis of [[45, 52, 45, 52], [48, 55, 48, 55, 60], [50, 57, 62, 57, 50], [40, 47, 52, 47, 40]]) {
      for (const target of [0, 3, 5]) {
        const r = fingerRiff(timed(midis, 0.2), STANDARD, { ...opt, target });
        for (let i = 1; i < r.pos.length; i++) {
          const a = r.pos[i - 1]!;
          const b = r.pos[i]!;
          if (a.string === b.string) expect(Math.abs(a.fret - b.fret), `${midis} @${target}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('prefers a triad grip on adjacent strings (C-E-G fast)', () => {
    const r = fingerRiff(timed([48, 52, 55], 0.1), STANDARD, { ...opt, target: 0 });
    // C3 A:3, E3 D:2, G3 G:0 - three adjacent strings.
    expect(r.pos.map((p) => p.string)).toEqual([1, 2, 3]);
  });

  it('works without timing (backwards compatible)', () => {
    const r = fingerRiff([{ midi: 45 }, { midi: 48 }], STANDARD, { ...opt, target: 0 });
    expect(r.pos).toHaveLength(2);
  });
});
