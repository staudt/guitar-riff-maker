import { describe, expect, it } from 'vitest';
import { LiveTracker } from './stream';
import { hzToMidi } from './pitch';
import type { PitchFrame } from './types';

function sine(hz: number, rate: number, secs: number): Float32Array {
  const x = new Float32Array(Math.round(rate * secs));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

describe('LiveTracker', () => {
  for (const rate of [48000, 44100, 16000]) {
    it(`tracks a 440 Hz tone fed in 2048-sample chunks at ${rate} Hz`, () => {
      const x = sine(440, rate, 1.5);
      const lt = new LiveTracker(rate, 'voice');
      const frames: PitchFrame[] = [];
      for (let i = 0; i < x.length; i += 2048) frames.push(...lt.push(x.subarray(i, Math.min(x.length, i + 2048))));
      expect(frames.length).toBeGreaterThan(120);
      for (let i = 1; i < frames.length; i++) expect(frames[i]!.t - frames[i - 1]!.t).toBeCloseTo(0.01, 6);
      const voiced = frames.filter((f) => f.hz > 0);
      expect(voiced.length / frames.length).toBeGreaterThan(0.95);
      for (const f of voiced) expect(Math.abs(hzToMidi(f.hz) - 69)).toBeLessThan(0.1);
    });
  }

  it('follows a pitch change and reports unvoiced silence', () => {
    const rate = 44100;
    const a = sine(220, rate, 0.6);
    const gap = new Float32Array(Math.round(rate * 0.3));
    const b = sine(330, rate, 0.6);
    const x = new Float32Array(a.length + gap.length + b.length);
    x.set(a, 0); x.set(gap, a.length); x.set(b, a.length + gap.length);
    const lt = new LiveTracker(rate, 'voice');
    const frames: PitchFrame[] = [];
    for (let i = 0; i < x.length; i += 1000) frames.push(...lt.push(x.subarray(i, Math.min(x.length, i + 1000))));
    const at = (t: number) => frames.reduce((p, f) => (Math.abs(f.t - t) < Math.abs(p.t - t) ? f : p));
    expect(hzToMidi(at(0.3).hz)).toBeCloseTo(57, 0);
    expect(at(0.75).hz).toBe(0);
    expect(hzToMidi(at(1.2).hz)).toBeCloseTo(64.02, 0);
  });
});
