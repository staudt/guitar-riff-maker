import { describe, expect, it } from 'vitest';
import { toRiff } from '../../src/capture/toRiff';
import type { RawNote, Transcription } from '../../src/capture/types';

// Free timing: no bpm is given, the tempo is estimated. Notes start at an arbitrary time with a little jitter.
const stepS = 60 / 100 / 4;
const T0 = 0.37;
const jit = (i: number) => ((i * 7) % 5 - 2) * 0.006;
const mk = (midis: number[], every = 2, len = 2): RawNote[] =>
  midis.map((m, i) => ({ start: T0 + i * every * stepS + jit(i), end: (i * every + len) * stepS - 0.02, midi: m, velocity: 90 }));
const tr = (notes: RawNote[]): Transcription => ({ source: 'whistle', notes, model: true });
const opts = { power: 'off' as const, tuningLow: 40 };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

describe('toRiff', () => {
  const aMinor = [81, 84, 83, 81, 76, 79, 81, 88]; // A5 line, whistle-high
  it('brings a high whistle into guitar range', () => {
    const r = toRiff(tr(mk(aMinor.map((m) => m + 12))), opts);
    const m = r.notes.map((n) => n.midi);
    expect(Math.min(...m)).toBeGreaterThanOrEqual(40);
    expect(Math.abs(median(m) - 55)).toBeLessThanOrEqual(7);
  });
  it('detects A minor', () => {
    const r = toRiff(tr(mk([57, 60, 59, 57, 52, 55, 57, 60])), opts);
    expect(r.key.tonic).toBe(9);
    expect(r.key.scale).toBe('minor');
  });
  it('picks a sensible length, tempo and grid without any hint', () => {
    const r = toRiff(tr(mk([57, 60, 59, 57, 55, 57, 60, 62])), opts);
    expect(r.bars).toBeGreaterThanOrEqual(1);
    expect(r.bars).toBeLessThanOrEqual(16);
    expect(r.bpm).toBeGreaterThanOrEqual(40);
    expect(r.bpm).toBeLessThanOrEqual(240);
    expect([8, 16]).toContain(r.grid);
    expect(r.notes.length).toBeGreaterThan(0);
    if (r.grid === 8) for (const n of r.notes) expect(n.step % 2).toBe(0);
  });
  it('accepts a tempo hint', () => {
    const r = toRiff(tr(mk([57, 60, 59, 57, 55, 57, 60, 62])), { ...opts, hintBpm: 100 });
    expect(Math.abs(r.bpm - 100)).toBeLessThanOrEqual(2);
  });
  it('preserves capture.raw (shifted by the same octaves, re-timed to the riff start) and bpm', () => {
    const raw = mk(aMinor);
    const r = toRiff(tr(raw), opts);
    expect(r.capture?.bpm).toBeGreaterThan(0);
    expect(r.capture?.raw.length).toBe(raw.length);
    const d = r.capture!.raw[0]!.midi - raw[0]!.midi;
    expect(Math.abs(d % 12)).toBe(0);
    const dt = raw[0]!.start - r.capture!.raw[0]!.start;
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]!.start - r.capture!.raw[i]!.start).toBeCloseTo(dt, 9);
      expect(r.capture!.raw[i]!.midi - raw[i]!.midi).toBe(d);
    }
    expect(r.notes[0]!.midi - Math.round(raw[0]!.midi)).toBe(d);
  });
  it('handles an empty take and applies base', () => {
    const r = toRiff(tr([]), { ...opts, base: { name: 'X' } });
    expect(r.notes).toEqual([]);
    expect(r.name).toBe('X');
  });
});
