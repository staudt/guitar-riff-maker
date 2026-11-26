// End to end without the ML model: a freely-timed whistled riff (no metronome, arbitrary tempo and
// start time, whistled two octaves up) -> YIN tracker -> segmentation -> toRiff. The riff that comes
// out must have the right pitches (in guitar range), the right rhythm and sustained note lengths.
import { describe, expect, it } from 'vitest';
import { renderMelody, type ExpectedNote } from './synth';
import { trackPitch } from '../../src/capture/pitch';
import { segmentNotes } from '../../src/capture/notes';
import { toRiff } from '../../src/capture/toRiff';

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

describe('free recording -> riff (YIN fallback path)', () => {
  for (const bpm of [84, 103, 121]) {
    it(`whistle at ${bpm} bpm, unknown start time`, () => {
      const rate = 44100;
      const audio = renderMelody(perform(bpm, 0.43, 24), 'whistle', { rate, seed: bpm });
      const raw = segmentNotes(trackPitch(audio, rate, 'whistle'));
      const r = toRiff({ source: 'whistle', notes: raw, model: false }, { power: 'off', tuningLow: 40 });

      // Pitches: same melody, folded into guitar range (octave may differ, contour must not).
      expect(r.notes.map((n) => n.midi - r.notes[0]!.midi)).toEqual(RIFF.map((n) => n.midi - RIFF[0]!.midi));
      expect(Math.min(...r.notes.map((n) => n.midi))).toBeGreaterThanOrEqual(40);

      // Rhythm: onsets/lengths match the written riff up to a uniform x2 / x0.5 (half/double tempo).
      const k = r.notes[1]!.step / RIFF[1]!.step;
      expect([0.5, 1, 2]).toContain(k);
      r.notes.forEach((n, i) => {
        expect(n.step).toBe(RIFF[i]!.step * k);
        expect(n.length).toBe(RIFF[i]!.len * k);
      });
      const tempo = r.bpm * (1 / k);
      expect(Math.abs(tempo - bpm) / bpm).toBeLessThan(0.04);
      expect(r.key.tonic).toBe(9); // A
    });
  }
});
