import { describe, expect, it } from 'vitest';
import { autoQuantize, cleanNotes, estimateTempo } from '../../src/capture/tempo';
import type { RawNote } from '../../src/capture/types';

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `ideal` = unjittered onset times; `notes` = performed (jittered) takes. */
type Riff = { notes: RawNote[]; ideal: number[]; bpm: number; simple: boolean };

function genRiff(seed: number): Riff {
  const r = prng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const bpm = 70 + r() * 80;
  const stepSec = 60 / bpm / 4;
  const simple = r() < 0.3;
  const values = simple ? [4, 2, 2] : [4, 2, 2, 1, 3];
  const n = 6 + Math.floor(r() * 19);
  const scale = [0, 2, 4, 7, 9];
  const notes: RawNote[] = [];
  const ideal: number[] = [];
  let step = 0;
  const start0 = 0.3 + r() * 0.3;
  for (let i = 0; i < n; i++) {
    const v = values[Math.floor(r() * values.length)]!;
    if (r() < 0.08) step += simple ? 2 : v; // rest
    ideal.push(start0 + step * stepSec);
    const t = start0 + step * stepSec + gauss() * 0.02;
    const ioi = v * stepSec;
    const end = t + ioi * (0.6 + r() * 0.35);
    let midi = 60 + scale[Math.floor(r() * 5)]! + 12 * Math.floor(r() * 2);
    // cleanNotes merges same-pitch neighbours closer than 60 ms, so riffs avoid immediate repeats.
    if (notes.length && notes[notes.length - 1]!.midi === midi) midi += 1;
    notes.push({ start: t, end, midi, velocity: 90 });
    step += v;
  }
  return { notes, ideal, bpm, simple };
}

describe('tempo detection (statistical)', () => {
  it('reconstructs timing and tempo on 200 random riffs', () => {
    let timingOk = 0, bpmOk = 0, simpleN = 0, simpleGrid8 = 0;
    for (let s = 1; s <= 200; s++) {
      const riff = genRiff(s * 7919);
      const fit = estimateTempo(cleanNotes(riff.notes));
      const stepSec = 60 / fit.bpm / 4;
      // Reconstructed onsets (offset + step * stepSec) vs the true, unjittered rhythm.
      const maxErr = Math.max(...riff.notes.map((n, i) => {
        const step = fit.steps![i]!;
        return Math.abs(fit.offset + step * stepSec - riff.ideal[i]!);
      }));
      if (maxErr <= 0.045) timingOk++;
      if ([1, 2, 0.5].some((k) => Math.abs(fit.bpm / (riff.bpm * k) - 1) < 0.03)) bpmOk++;
      if (riff.simple) { simpleN++; if (fit.grid === 8) simpleGrid8++; }
    }
    const rates = { timing: timingOk / 200, bpm: bpmOk / 200, grid8: simpleGrid8 / simpleN, simpleN };
    console.log('tempo stats', JSON.stringify(rates));
    expect(rates.timing).toBeGreaterThanOrEqual(0.9);
    expect(rates.bpm).toBeGreaterThanOrEqual(0.85);
    expect(rates.grid8).toBeGreaterThanOrEqual(0.85);
  });

  it('runs fast for 60 notes', () => {
    const notes: RawNote[] = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.25 + 0.01 * Math.sin(i), end: i * 0.25 + 0.2, midi: 60 + (i % 5), velocity: 90 }));
    const t = performance.now();
    estimateTempo(notes);
    // Wall clock under a parallel test run; tempo detection only runs on "Snap to beat".
    expect(performance.now() - t).toBeLessThan(250);
  });
});

describe('tempo detection (cases)', () => {
  const mk = (start: number, end: number, midi = 60): RawNote => ({ start, end, midi, velocity: 100 });

  it('straight 8ths at 96 bpm -> grid 8', () => {
    const r = prng(5);
    const notes = Array.from({ length: 16 }, (_, i) => mk(0.4 + i * 0.3125 + (r() - 0.5) * 0.03, 0.4 + i * 0.3125 + 0.25, 60 + (i % 4)));
    const fit = estimateTempo(notes);
    expect([48, 96, 192].some((b) => Math.abs(fit.bpm / b - 1) < 0.03)).toBe(true);
    expect(fit.grid).toBe(8);
  });

  it('keeps half-note lengths', () => {
    const q = 0.5; // 120 bpm
    const notes = [mk(0.2, 0.2 + q * 1.95, 60), mk(0.2 + 2 * q, 0.2 + 3.95 * q, 64), mk(0.2 + 4 * q, 0.2 + 5.95 * q, 67), mk(0.2 + 6 * q, 0.2 + 7.9 * q, 64)];
    const riff = autoQuantize(notes);
    const stepSec = 60 / riff.bpm / 4;
    for (const n of riff.notes) expect(n.length * stepSec).toBeCloseTo(1, 0);
    expect(riff.notes.map((n) => n.length).every((l) => l === riff.notes[0]!.length)).toBe(true);
  });

  it('merges fragmented same-pitch notes', () => {
    const out = cleanNotes([mk(1, 1.3, 60.2), mk(1.33, 1.6, 59.8), mk(1.63, 2, 60.1), mk(2.5, 3, 64)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 1, end: 2, midi: 60 });
  });

  it('honours hintBpm', () => {
    const q = 60 / 90;
    const notes = [0, 1, 2, 2.5, 3, 4, 5, 5.5, 6, 7].map((b, i) => mk(0.5 + b * q, 0.5 + b * q + q * 0.4, 60 + (i % 3)));
    const fit = estimateTempo(notes, { hintBpm: 90 });
    expect(Math.abs(fit.bpm - 90)).toBeLessThan(1);
  });

  it('does not throw on 0 or 1 notes', () => {
    expect(() => estimateTempo([])).not.toThrow();
    expect(estimateTempo([mk(1, 1.5)]).bpm).toBe(100);
    expect(autoQuantize([]).notes).toEqual([]);
    expect(autoQuantize([mk(1, 1.5)]).notes).toHaveLength(1);
  });
});
