import { describe, expect, it } from 'vitest';
import { joinChunks, trimSilence } from './trim';

const RATE = 48000;
function tone(n: number, from: number, to: number, amp: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = from; i < to; i++) x[i] = amp * Math.sin(i * 0.3);
  return x;
}

describe('trimSilence', () => {
  it('cuts silence but keeps 10 ms before the first sound', () => {
    const x = tone(RATE, 24000, 36000, 0.5);
    const out = trimSilence(x, undefined, RATE)!;
    const pad = Math.round(0.01 * RATE);
    // first loud sample is at or just after 24000 (sin(0) = 0 at i=0 offset); allow a few samples
    expect(out.l.length).toBeGreaterThan(12000 + pad);
    expect(out.l.length).toBeLessThanOrEqual(12000 + 2 * pad + 1);
    expect(Math.abs(out.l[pad + 5]!)).toBeGreaterThan(0);
  });
  it('treats a quiet noise floor below -45 dBFS as silence', () => {
    expect(trimSilence(tone(RATE, 0, RATE, 0.002), undefined, RATE)).toBeNull();
  });
  it('keeps everything above the threshold, trims stereo together', () => {
    const l = tone(1000, 100, 200, 0.5);
    const r = tone(1000, 150, 400, 0.5);
    const out = trimSilence(l, r, RATE, -45, 0, 0)!;
    expect(out.l.length).toBe(out.r!.length);
    expect(out.l.length).toBeGreaterThan(250);
    expect(out.l.length).toBeLessThanOrEqual(300);
  });
  it('does not run past the buffer edges', () => {
    const x = tone(100, 0, 100, 0.5);
    const out = trimSilence(x, undefined, RATE)!;
    expect(out.l.length).toBeLessThanOrEqual(100);
    expect(out.l.length).toBeGreaterThan(90);
  });
});

describe('joinChunks', () => {
  it('concatenates in order', () => {
    const out = joinChunks([Float32Array.of(1, 2), Float32Array.of(3), new Float32Array(0), Float32Array.of(4, 5)]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});
