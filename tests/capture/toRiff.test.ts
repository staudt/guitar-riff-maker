import { describe, expect, it } from 'vitest';
import { toRiff } from '../../src/capture/toRiff';
import type { RawNote, Transcription } from '../../src/capture/types';

const BPM = 90;
const stepS = 60 / BPM / 4;
const mk = (midis: number[], every = 2, len = 2): RawNote[] =>
  midis.map((m, i) => ({ start: i * every * stepS + 0.01, end: (i * every + len) * stepS - 0.02, midi: m, velocity: 90 }));
const tr = (notes: RawNote[]): Transcription => ({ source: 'whistle', notes, model: true });
const opts = { bpm: BPM, bars: 2 as const, grid: 16 as const, power: 'off' as const, tuningLow: 40 };
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
  it('uses even steps on the 1/8 grid', () => {
    const r = toRiff(tr(mk([57, 60, 59, 57, 55], 1, 1)), { ...opts, grid: 8 });
    expect(r.notes.length).toBeGreaterThan(0);
    for (const n of r.notes) expect(n.step % 2).toBe(0);
  });
  it('preserves capture.raw (shifted by the same octaves) and bpm', () => {
    const raw = mk(aMinor);
    const r = toRiff(tr(raw), opts);
    expect(r.capture?.bpm).toBe(BPM);
    expect(r.capture?.raw.length).toBe(raw.length);
    const d = r.capture!.raw[0]!.midi - raw[0]!.midi;
    expect(Math.abs(d % 12)).toBe(0);
    expect(r.capture!.raw[0]!.start).toBe(raw[0]!.start);
    expect(r.notes[0]!.midi - Math.round(raw[0]!.midi)).toBe(d);
  });
  it('handles an empty take and applies base', () => {
    const r = toRiff(tr([]), { ...opts, base: { name: 'X' } });
    expect(r.notes).toEqual([]);
    expect(r.name).toBe('X');
  });
});
