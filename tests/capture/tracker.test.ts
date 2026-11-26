// Live tracker path (YIN + segmentation) on synthetic fixtures, plus quantize, key and transpose.
import { describe, expect, it } from 'vitest';
import { hzToMidi, resampleTo16k, trackPitch, TRACK_RATE, yinFrame } from '../../src/capture/pitch';
import { quantize, segmentNotes } from '../../src/capture/notes';
import { detectKey, fitInterval, octaveFit, outOfKey, transposeDiatonic } from '../../src/capture/key';
import { noteAccuracy } from '../../src/capture/score';
import { fixtures, melodyNotes } from './synth';

describe('YIN', () => {
  for (const f0 of [82.4, 110, 220, 440, 880, 1760, 3000]) {
    it(`finds ${f0} Hz within 10 cents`, () => {
      const x = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * f0 * i) / TRACK_RATE) + 0.4 * Math.sin((4 * Math.PI * f0 * i) / TRACK_RATE));
      const tauMax = Math.ceil(TRACK_RATE / 60);
      const r = yinFrame(x, 0, Math.max(256, tauMax), 4, tauMax, new Float64Array(tauMax + 2));
      expect(Math.abs(1200 * Math.log2(r.hz / f0))).toBeLessThan(10);
      expect(r.clarity).toBeGreaterThan(0.9);
    });
  }

  it('resampling to 16 kHz keeps the pitch', () => {
    const x = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 330 * i) / 48000));
    const y = resampleTo16k(x, 48000);
    expect(y.length).toBe(16000);
    const tauMax = 400;
    const r = yinFrame(y, 1000, 400, 4, tauMax, new Float64Array(tauMax + 2));
    expect(Math.abs(hzToMidi(r.hz) - hzToMidi(330))).toBeLessThan(0.1);
  });
});

describe('live tracker on synthetic fixtures (target: 90 % mono)', () => {
  for (const fx of fixtures().filter((f) => f.source !== 'chords')) {
    it(`${fx.name}: notes right (pitch + onset within 50 ms)`, () => {
      const frames = trackPitch(fx.audio, fx.rate, fx.source);
      const notes = segmentNotes(frames);
      const r = noteAccuracy(fx.notes, notes, { octaveFree: fx.octaveFree });
      expect(r.accuracy, `${fx.name}: ${r.matched}/${fx.notes.length}, extra ${r.extra}`).toBeGreaterThanOrEqual(0.9);
      expect(r.extra, `${fx.name}: spurious notes`).toBeLessThanOrEqual(1);
    });
  }
});

describe('quantize, key, transpose', () => {
  it('quantizes to the 1/8 grid and builds a pattern with holds', () => {
    const bpm = 100;
    const notes = melodyNotes(bpm).map((n) => ({ ...n, start: n.start - 0.3, end: n.end - 0.3, midi: n.midi + 0.2, velocity: 100 }));
    const g = quantize(notes, bpm, 8, 32);
    expect(g.map((n) => n.step)).toEqual([0, 4, 6, 8, 12, 16, 18, 20, 24, 26, 28]);
    expect(g.map((n) => n.midi)).toEqual([69, 72, 71, 69, 64, 65, 67, 69, 69, 67, 64]);
  });

  it('detects A minor and fits it to C minor by +3 (the mockup example)', () => {
    const notes = melodyNotes().map((n) => ({ ...n, velocity: 100 }));
    const k = detectKey(notes);
    expect(k).toMatchObject({ tonic: 9, scale: 'minor' });
    expect(fitInterval(k, 0, 'minor')).toBe(3);
    expect(fitInterval({ tonic: 0, scale: 'major', score: 1 }, 0, 'minor')).toBe(3); // C major -> Eb major (relative of C minor)
    expect(fitInterval({ tonic: 7, scale: 'minor', score: 1 }, 0, 'minor')).toBe(5); // G minor -> C minor
  });

  it('diatonic shift stays in key; out-of-key flags', () => {
    const notes = [60, 62, 63, 65, 67].map((m, i) => ({ step: i * 2, length: 2, midi: m, velocity: 100 }));
    const up2 = transposeDiatonic(notes, 2, 0, 'minor');
    expect(up2.map((n) => n.midi)).toEqual([63, 65, 67, 68, 70]);
    expect(outOfKey(up2, 0, 'minor').every((x) => !x)).toBe(true);
    expect(outOfKey([{ step: 0, length: 1, midi: 64, velocity: 1 }], 0, 'minor')).toEqual([true]);
    expect(octaveFit([{ step: 0, length: 1, midi: 88, velocity: 1 }], 66)).toBe(-24);
  });
});

describe('grid accuracy (fixture recorder scoring)', () => {
  it('finds the global offset and scores notes on the 1/8 grid', async () => {
    const { gridAccuracy } = await import('../../src/capture/score');
    const exp = [0, 0.6, 1.2, 1.8].map((t, i) => ({ start: t, midi: 60 + i }));
    // A human performance: 120 ms late overall, ±40 ms jitter, one wrong pitch.
    const got = exp.map((e, i) => ({ start: e.start + 0.12 + [0.03, -0.04, 0.02, 0][i]!, midi: i === 3 ? 70 : e.midi }));
    const r = gridAccuracy(exp, got, { bpm: 100 });
    expect(r.matched).toBe(3);
    expect(r.offset).toBeGreaterThan(0.05);
  });
});
