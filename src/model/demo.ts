// A recognisable A-minor riff so the editor has something to show before capture exists.
import { newRiff, type Riff, type RiffNote } from './riff';

export function demoRiff(): Riff {
  // [step, midi, length]
  const spec: [number, number, number][] = [
    [0, 45, 2], [2, 48, 2], [4, 50, 2], [6, 52, 2], [8, 55, 2], [10, 52, 2], [12, 50, 2], [14, 48, 2],
    [16, 45, 4], [20, 45, 2], [22, 48, 2], [24, 50, 2], [26, 52, 2], [28, 55, 2], [30, 57, 2],
  ];
  const notes: RiffNote[] = spec.map(([step, midi, length], i) => ({
    id: `demo${i}`,
    step,
    length,
    midi,
    velocity: i % 4 === 0 ? 110 : 90,
  }));
  return newRiff({ name: 'Demo riff', id: 'demo', bpm: 96, bars: 2, grid: 16, notes });
}
