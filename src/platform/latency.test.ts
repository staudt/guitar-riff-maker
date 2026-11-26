import { describe, expect, it } from 'vitest';
import { detectClickDelays, medianLatencyMs } from './latency';

function rng(seed: number) {
  let s = seed;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

function synth(rate: number, delay: number, times: number[], amp: number, noise: number, seed = 5): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(rate * (times[times.length - 1]! + 1.2)));
  for (let i = 0; i < x.length; i++) x[i] = (r() - 0.5) * 2 * noise;
  for (const t of times) {
    const a = Math.round((t + delay) * rate);
    for (let k = 0; k < rate * 0.02 && a + k < x.length; k++) x[a + k]! += amp * Math.sin((2 * Math.PI * 1800 * k) / rate) * Math.exp(-k / (rate * 0.005)) * Math.min(1, k / (rate * 0.0008));
  }
  return x;
}

describe('detectClickDelays', () => {
  const times = [0.4, 1.0, 1.6, 2.2, 2.8, 3.4];
  for (const [rate, delay] of [[48000, 0.123], [44100, 0.047], [48000, 0.31]] as const) {
    it(`finds a ${delay * 1000} ms delay at ${rate} Hz in noise`, () => {
      const rec = synth(rate, delay, times, 0.2, 0.02);
      const d = detectClickDelays(rec, rate, times);
      expect(d.every((v) => v !== null)).toBe(true);
      for (const v of d) expect(Math.abs(v! - delay)).toBeLessThan(0.0015);
      expect(Math.abs(medianLatencyMs(d)! - delay * 1000)).toBeLessThan(1.5);
    });
  }

  it('ignores a click that is missing', () => {
    const rec = synth(48000, 0.1, times, 0.2, 0.01);
    // Wipe the second click entirely (it arrives at 1.1 s).
    rec.fill(0, Math.round(1.05 * 48000), Math.round(1.25 * 48000));
    const d = detectClickDelays(rec, 48000, times);
    expect(d[1]).toBeNull();
    expect(d.filter((v) => v !== null)).toHaveLength(5);
    expect(medianLatencyMs(d)!).toBeGreaterThan(98);
    expect(medianLatencyMs(d)!).toBeLessThan(102);
  });

  it('returns null for silence', () => {
    const rec = new Float32Array(48000 * 4);
    expect(medianLatencyMs(detectClickDelays(rec, 48000, times))).toBeNull();
  });
});
