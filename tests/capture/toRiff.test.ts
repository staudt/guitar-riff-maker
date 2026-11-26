import { describe, expect, it } from 'vitest';
import { buildFree, fitShift, toRiff, toRiffFree } from '../../src/capture/toRiff';
import type { PitchFrame, RawNote, Transcription } from '../../src/capture/types';

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

describe('toRiffFree / buildFree', () => {
  // 100 fps frames: 0.3 s silence, A5 0.3 s, gap 0.1 s, C6 0.4 s.
  const frames: PitchFrame[] = [];
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
  for (let i = 0; i < 160; i++) {
    const t = i * 0.01;
    const m = t >= 0.3 && t < 0.6 ? 81 : t >= 0.7 && t < 1.1 ? 84 : 0;
    frames.push({ t, hz: m ? hz(m) : 0, clarity: m ? 0.95 : 0, rms: m ? 0.2 : 0.0005 });
  }
  it('timing free, ticks of 10 ms, src = note initial, octave-shifted trace, span', () => {
    const r = toRiffFree(frames, opts);
    expect(r.timing).toBe('free');
    expect(r.notes.length).toBe(2);
    const [a, b] = r.notes;
    expect(a!.midi).toBe(57); // 81 - 24
    expect(b!.midi).toBe(60);
    expect(a!.src).toEqual({ step: a!.step, length: a!.length, midi: a!.midi });
    expect(a!.length).toBeGreaterThanOrEqual(28);
    expect(a!.length).toBeLessThanOrEqual(31);
    expect(b!.step - a!.step).toBeGreaterThanOrEqual(38);
    expect(b!.step - a!.step).toBeLessThanOrEqual(42);
    expect(r.span).toBe(b!.step + b!.length + 50);
    // First sound sits ~50 ms into the riff; the trace starts at riff time ~0 and carries the shift.
    expect(a!.step).toBeGreaterThanOrEqual(4);
    expect(a!.step).toBeLessThanOrEqual(7);
    expect(r.trace!.start).toBeCloseTo(0, 1);
    const voiced = r.trace!.midi.filter((m): m is number => m !== null);
    expect(Math.min(...voiced)).toBeCloseTo(57, 1);
    expect(Math.max(...voiced)).toBeCloseTo(60, 1);
    expect(r.trace!.midi.some((m) => m === null)).toBe(true); // the gap
    expect(r.capture!.raw.length).toBe(2);
    expect(r.capture!.raw[0]!.midi).toBeCloseTo(57, 1);
  });
  it('buildFree without a trace (test hook) and with a minimum length of 3 ticks', () => {
    const r = buildFree([{ start: 1, end: 1.01, midi: 60, velocity: 90 }, { start: 1.5, end: 2, midi: 62, velocity: 90 }], null, opts);
    expect(r.trace).toBeUndefined();
    expect(r.timing).toBe('free');
    expect(r.notes[0]!.length).toBe(3);
    expect(r.notes[0]!.step).toBe(5);
  });
  it('fitShift: centre 55 (45 with power chords), never below the low string', () => {
    expect(fitShift([81, 84], 'off', 40)).toBe(-24);
    expect(fitShift([81, 84], 'r5', 40)).toBe(-36);
    expect(fitShift([30, 31], 'off', 40)).toBeGreaterThanOrEqual(12);
  });
});
