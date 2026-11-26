import { describe, expect, it } from 'vitest';
import { assertNormalized } from './helpers';
import { demoRiff } from '../../src/model/demo';
import { newRiff, normalize, parseRiff, type RiffNote } from '../../src/model/riff';

const note = (id: string, step: number, length: number, midi = 45): RiffNote => ({ id, step, length, midi, velocity: 100 });

describe('newRiff', () => {
  it('has the documented defaults', () => {
    const r = newRiff();
    expect(r).toMatchObject({ name: 'Untitled riff', bpm: 96, grid: 16, bars: 2, maxFret: 22, power: 'off', instrument: 'clean', notes: [] });
    expect(r.key).toEqual({ tonic: 9, scale: 'minor' });
    expect(r.tuning.strings).toEqual([40, 45, 50, 55, 59, 64]);
    expect(r.region).toEqual({ mode: 'auto', choice: -1 });
  });
});

describe('normalize', () => {
  it('sorts, drops out-of-range, clamps and cuts at next onset', () => {
    const r = normalize(
      newRiff({
        notes: [note('c', 30, 10), note('a', 0, 8), note('x', 32, 1), note('y', -1, 2), note('z', 5, 0), note('b', 4, 8)],
      }),
    );
    expect(r.notes.map((n) => [n.id, n.step, n.length])).toEqual([['a', 0, 4], ['b', 4, 8], ['c', 30, 2]]);
    assertNormalized(r);
  });
  it('keeps the later-in-array note on a shared step', () => {
    const r = normalize(newRiff({ notes: [note('old', 4, 2), note('new', 4, 3)] }));
    expect(r.notes.map((n) => n.id)).toEqual(['new']);
  });
  it('rounds and clamps values', () => {
    const r = normalize(newRiff({ notes: [{ id: 'a', step: 1.4, length: 2.6, midi: 200, velocity: 0 }] }));
    expect(r.notes[0]).toMatchObject({ step: 1, length: 3, midi: 127, velocity: 1 });
  });
});

describe('parseRiff', () => {
  it('round-trips', () => {
    const r = demoRiff();
    expect(parseRiff(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });
  it('rejects junk', () => {
    expect(() => parseRiff(null)).toThrow();
    expect(() => parseRiff({ v: 1 })).toThrow();
    expect(() => parseRiff({ ...demoRiff(), bars: 3 })).toThrow();
    expect(() => parseRiff({ ...demoRiff(), v: 2 })).toThrow();
  });
});
