// Segmentation quality on whistle/hum riff fixtures (re-articulation, fast, legato, glides, vibrato, octave glitches).
import { describe, expect, it } from 'vitest';
import { trackPitch } from '../../src/capture/pitch';
import { segmentNotes } from '../../src/capture/notes';
import { noteAccuracy } from '../../src/capture/score';
import { lineFixtures } from './lines';

const rows: string[] = [];
let sumM = 0, sumE = 0, sumX = 0;

describe('segmentation on riff-like whistle fixtures', () => {
  for (const fx of lineFixtures()) {
    it(fx.name, () => {
      let frames = trackPitch(fx.audio, fx.rate, fx.source);
      if (fx.post) frames = fx.post(frames);
      const notes = segmentNotes(frames);
      const r = noteAccuracy(fx.notes, notes);
      sumM += r.matched; sumX += fx.notes.length; sumE += r.extra;
      rows.push(`${fx.name.padEnd(18)} recall ${r.matched}/${fx.notes.length}  extra ${r.extra}  got ${notes.length}`);
      expect(r.matched / fx.notes.length, rows[rows.length - 1]).toBeGreaterThanOrEqual(0.9);
    });
  }
  it('overall recall >= 95 %, precision >= 92 %', () => {
    const recall = sumM / sumX;
    const precision = sumM / (sumM + sumE);
    if (process.env.SEG_PRINT) console.log(rows.join('\n') + `\nTOTAL recall ${(recall * 100).toFixed(1)}%  precision ${(precision * 100).toFixed(1)}%`);
    expect(recall).toBeGreaterThanOrEqual(0.95);
    expect(precision).toBeGreaterThanOrEqual(0.92);
  });
});
