// Final transcription (Basic Pitch) on the synthetic fixtures. Targets agreed with the user:
// 90 % of notes for voice / whistle / guitar, 75 % of chord notes for strummed chords.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transcribe, type ModelFiles } from '../../src/capture/transcribe';
import { noteAccuracy } from '../../src/capture/score';
import { fixtures } from './synth';

const dir = 'node_modules/@spotify/basic-pitch/model/';
const files: ModelFiles = {
  json: JSON.parse(readFileSync(dir + 'model.json', 'utf8')) as ModelFiles['json'],
  weights: (() => {
    const b = readFileSync(dir + 'group1-shard1of1.bin');
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  })(),
};

// The ML model takes minutes per case on CPU: run with `pnpm test:slow`.
describe.skipIf(!process.env.SLOW)('Basic Pitch transcription', () => {
  for (const fx of fixtures()) {
    const target = fx.source === 'chords' ? 0.75 : 0.9;
    it(`${fx.name}: >= ${target * 100} % of notes`, { timeout: 180_000 }, async () => {
      const t = await transcribe(fx.audio, fx.rate, fx.source, { files });
      expect(t.model, 'model ran (no fallback)').toBe(true);
      const r = noteAccuracy(fx.notes, t.notes, { octaveFree: fx.octaveFree });
      console.log(`${fx.name}: ${(r.accuracy * 100).toFixed(0)} % (${r.matched}/${fx.notes.length}), extra ${r.extra}`);
      expect(r.accuracy).toBeGreaterThanOrEqual(target);
    });
  }
});
