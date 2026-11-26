// Fake microphone input for the capture specs: WAV files Chromium plays as the mic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderMelody, type ExpectedNote } from '../capture/synth';

const RATE = 48000;
const DIR = resolve('test-results', 'fake-mic');
mkdirSync(DIR, { recursive: true });

function wav(x: Float32Array): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2);
  return b;
}

/** A hummed A-minor line (A3 C4 B3 A3 E3, 8th notes at 92 BPM) starting 0.35 s in, and a click track for calibration. */
function makeFiles(): { melody: string; clicks: string; whistle: string } {
  const eighth = 60 / 92 / 2;
  const line = [57, 60, 59, 57, 52, 55, 57, 57];
  const notes: ExpectedNote[] = line.map((m, k) => ({ start: 0.35 + k * eighth * 1.0, end: 0.35 + k * eighth + eighth * 0.85, midi: m }));
  const mel = renderMelody(notes, 'hum', { rate: RATE, seed: 3, noiseDb: -50 });
  const total = new Float32Array(Math.round(RATE * 12));
  total.set(mel.subarray(0, Math.min(mel.length, total.length)));
  const clicks = new Float32Array(RATE * 12);
  for (let j = 0; j < 14; j++) {
    const a = Math.round((0.8 + 0.6 * j) * RATE);
    for (let k = 0; k < RATE * 0.02 && a + k < clicks.length; k++) clicks[a + k]! += 0.6 * Math.sin((2 * Math.PI * 1800 * k) / RATE) * Math.exp(-k / (RATE * 0.005));
  }
  // The same line whistled two octaves up, freely timed (not on any beat grid), with a repeated last note.
  const wnotes: ExpectedNote[] = [0, 0.27, 0.52, 0.81, 1.02, 1.36, 1.71, 2.05].map((t, k) => ({
    start: 0.4 + t,
    end: 0.4 + t + (k === 7 ? 0.5 : 0.2),
    midi: line[k]! + 24,
  }));
  const whis = new Float32Array(Math.round(RATE * 12));
  const wmel = renderMelody(wnotes, 'whistle', { rate: RATE, seed: 5, noiseDb: -50 });
  whis.set(wmel.subarray(0, Math.min(wmel.length, whis.length)));
  const w = join(DIR, 'whistle.wav');
  writeFileSync(w, wav(whis));
  const m = join(DIR, 'melody.wav');
  const c = join(DIR, 'clicks.wav');
  writeFileSync(m, wav(total));
  writeFileSync(c, wav(clicks));
  return { melody: m, clicks: c, whistle: w };
}
export const files = makeFiles();
export const fakeMic = (file: string) => ({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });

