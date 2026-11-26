// A recognisable A-minor riff so the editor has something to show before capture exists.
import { newRiff, TICK_MS, type Riff, type RiffNote, type Trace } from './riff';

const SPEC: [number, number, number][] = [
  [0, 45, 2], [2, 48, 2], [4, 50, 2], [6, 52, 2], [8, 55, 2], [10, 52, 2], [12, 50, 2], [14, 48, 2],
  [16, 45, 4], [20, 45, 2], [22, 48, 2], [24, 50, 2], [26, 52, 2], [28, 55, 2], [30, 57, 2],
];

export function demoRiff(): Riff {
  const spec = SPEC;
  const notes: RiffNote[] = spec.map(([step, midi, length], i) => ({
    id: `demo${i}`,
    step,
    length,
    midi,
    velocity: i % 4 === 0 ? 110 : 90,
  }));
  return newRiff({ name: 'Demo riff', id: 'demo', bpm: 96, bars: 2, grid: 16, notes });
}

/** The same melody in free timing (real-time ticks, ~0.6 s per 16 steps) with a synthetic whistled trace. */
export function demoFreeRiff(): Riff {
  const tick = (step: number) => Math.round(step * 18); // 180 ms per 16th, slightly loose
  const notes: RiffNote[] = SPEC.map(([step, midi, length], i) => {
    const s = tick(step) + (i % 3) * 2;
    const l = Math.max(4, Math.round(length * 18) - 4);
    return { id: `demofree${i}`, step: s, length: l, midi, velocity: i % 4 === 0 ? 110 : 90, src: { step: s, length: l, midi } };
  });
  const last = notes[notes.length - 1]!;
  const span = last.step + last.length + 40;
  const hop = 0.02;
  const points = Math.ceil((span * TICK_MS) / 1000 / hop);
  const midi: (number | null)[] = [];
  for (let p = 0; p < points; p++) {
    const tick10 = (p * hop * 1000) / TICK_MS;
    const idx = notes.findIndex((n) => tick10 >= n.step && tick10 < n.step + n.length);
    const n = notes[idx];
    if (!n) {
      midi.push(null);
      continue;
    }
    const t = (tick10 - n.step) / n.length;
    const prev = notes[idx - 1];
    const glide = prev && prev.step + prev.length >= n.step - 6 && t < 0.25 ? (prev.midi - n.midi) * (1 - t / 0.25) : 0;
    midi.push(n.midi + glide + 0.25 * Math.sin(tick10 * 0.5) * Math.min(1, t * 3));
  }
  const trace: Trace = { hop, start: 0, midi };
  return newRiff({ name: 'Demo free riff', id: 'demo-free', timing: 'free', span, notes, trace });
}
