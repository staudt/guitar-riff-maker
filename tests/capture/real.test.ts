// The user's real recordings (tests/fixtures/capture/*.wav + .json) through the final transcription.
// Skipped while the folder has no recordings. Targets: 90 % mono, 75 % chords.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transcribe, type ModelFiles } from '../../src/capture/transcribe';
import { gridAccuracy, noteAccuracy } from '../../src/capture/score';
import type { CaptureSource } from '../../src/capture/types';

const DIR = 'tests/fixtures/capture/';
const names = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4)) : [];

/** Minimal WAV reader: PCM 16/24/32-bit or float32; returns the first channel (or the mix). */
export function readWav(buf: Buffer): { audio: Float32Array; rate: number } {
  let p = 12;
  let fmt = { format: 1, channels: 1, rate: 44100, bits: 16 };
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const o = p + 8 + (i * fmt.channels + c) * bytes;
          sum += fmt.format === 3 ? buf.readFloatLE(o) : fmt.bits === 16 ? buf.readInt16LE(o) / 32768 : fmt.bits === 24 ? buf.readIntLE(o, 3) / 8388608 : buf.readInt32LE(o) / 2147483648;
        }
        out[i] = sum / fmt.channels;
      }
      return { audio: out, rate: fmt.rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

const dir = 'node_modules/@spotify/basic-pitch/model/';
const bin = existsSync(dir + 'group1-shard1of1.bin') ? readFileSync(dir + 'group1-shard1of1.bin') : null;
const files: ModelFiles | null = bin ? { json: JSON.parse(readFileSync(dir + 'model.json', 'utf8')) as ModelFiles['json'], weights: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) } : null;

describe.skipIf(names.length === 0)('real capture fixtures', () => {
  for (const name of names) {
    it(`${name}`, { timeout: 300_000 }, async () => {
      const meta = JSON.parse(readFileSync(DIR + name + '.json', 'utf8')) as { source: CaptureSource; notes: { start: number; end: number; midi: number }[]; octaveFree?: boolean; bpm?: number };
      const { audio, rate } = readWav(readFileSync(DIR + name + '.wav'));
      const t = await transcribe(audio, rate, meta.source, { files });
      // Recorded against a click (fixture recorder, `bpm` set): right note on the right 1/8 step.
      // Hand-annotated: pitch + onset within 50 ms.
      const r = meta.bpm ? gridAccuracy(meta.notes, t.notes, { bpm: meta.bpm, octaveFree: meta.octaveFree }) : noteAccuracy(meta.notes, t.notes, { octaveFree: meta.octaveFree });
      const target = meta.source === 'chords' ? 0.75 : 0.9;
      console.log(`${name}: ${(r.accuracy * 100).toFixed(0)} % (${r.matched}/${meta.notes.length}), extra ${r.extra}, model ${t.model}`);
      expect(r.accuracy).toBeGreaterThanOrEqual(target);
    });
  }
});
