// End to end without the ML model: a freely-timed whistled riff (no metronome, arbitrary tempo and
// start time, whistled two octaves up) -> YIN over the whole take -> notes cut from that same line ->
// free-timing riff with the trace. No tempo is assumed: notes keep the performed timing (10 ms ticks).
import { describe, expect, it } from 'vitest';
import { renderMelody, type ExpectedNote } from './synth';
import { trackPitch } from '../../src/capture/pitch';
import { segmentNotes } from '../../src/capture/notes';
import { toRiff, toRiffFree } from '../../src/capture/toRiff';
import { TICK_MS } from '../../src/model/riff';

// A2 C3 D3 E3 (8ths) | G3 (quarter) E3 (8th) D3 (8th) | A2 (half)  — in 16th steps:
const RIFF: { step: number; len: number; midi: number }[] = [
  { step: 0, len: 2, midi: 45 },
  { step: 2, len: 2, midi: 48 },
  { step: 4, len: 2, midi: 50 },
  { step: 6, len: 2, midi: 52 },
  { step: 8, len: 4, midi: 55 },
  { step: 12, len: 2, midi: 52 },
  { step: 14, len: 2, midi: 50 },
  { step: 16, len: 8, midi: 45 },
];

function perform(bpm: number, lead: number, octaveUp: number): ExpectedNote[] {
  const s = 60 / bpm / 4;
  return RIFF.map((n) => ({ start: lead + n.step * s, end: lead + (n.step + n.len) * s - 0.03, midi: n.midi + octaveUp }));
}
const opts = { power: 'off' as const, tuningLow: 40 };

describe('free recording -> free-timing riff', () => {
  for (const bpm of [84, 103, 121]) {
    it(`whistle at ${bpm} bpm, unknown start time`, () => {
      const rate = 44100;
      const played = perform(bpm, 0.43, 24);
      const audio = renderMelody(played, 'whistle', { rate, seed: bpm });
      const frames = trackPitch(audio, rate, 'whistle');
      const r = toRiffFree(frames, opts);
      expect(r.timing).toBe('free');
      expect(r.notes.length).toBe(RIFF.length);
      const off = r.notes[0]!.step * (TICK_MS / 1000) - played[0]!.start; // where the take starts in riff time
      r.notes.forEach((n, i) => {
        const p = played[i]!;
        expect(n.midi - (p.midi - 24)).toBe(r.notes[0]!.midi - RIFF[0]!.midi); // same contour, one octave shift
        expect(Math.abs(n.step * 0.01 - off - p.start), `onset ${i}`).toBeLessThan(0.03);
        expect(Math.abs(n.length * 0.01 - (p.end - p.start)), `length ${i}`).toBeLessThan(0.06);
        expect(n.src).toEqual({ step: n.step, length: n.length, midi: n.midi });
      });
      expect(Math.min(...r.notes.map((n) => n.midi))).toBeGreaterThanOrEqual(40);
      expect(r.key.tonic).toBe(9); // A
      expect(r.trace && r.trace.hop).toBeCloseTo(0.01, 6);
      expect(r.trace!.midi.some((m) => m !== null)).toBe(true);
      expect(r.span).toBeGreaterThan(r.notes[r.notes.length - 1]!.step);
    });
  }

  it('metronome mode: same line, snapped to the grid, trace kept', () => {
    const bpm = 100;
    const rate = 44100;
    const played = perform(bpm, 0.3, 24);
    const frames = trackPitch(renderMelody(played, 'whistle', { rate, seed: 5 }), rate, 'whistle');
    const notes = segmentNotes(frames).map((n) => ({ ...n, start: n.start - 0.3, end: n.end - 0.3 }));
    const r = toRiff({ source: 'whistle', notes, model: false, trace: { hop: 0.01, start: 0, midi: [null, 70.2, 70.1] } }, { ...opts, hintBpm: bpm });
    expect(r.timing).toBe('grid');
    expect(Math.abs(r.bpm - bpm)).toBeLessThanOrEqual(2);
    expect(r.notes.map((n) => n.step)).toEqual(RIFF.map((n) => n.step));
    expect(r.trace?.midi.length).toBe(3);
  });
});
