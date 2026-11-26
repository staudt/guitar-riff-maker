import { describe, expect, it } from 'vitest';
import { canOctave, gridUnit, reduce, type Action } from '../../src/model/edit';
import { demoRiff } from '../../src/model/demo';
import { newRiff, type Riff, type RiffNote } from '../../src/model/riff';
import { inScale } from '../../src/music/theory';
import { assertNormalized } from './helpers';

const base = () => demoRiff();
const strip = (n: RiffNote) => ({ step: n.step, length: n.length, midi: n.midi, velocity: n.velocity });

const table: [string, Action][] = [
  ['add', { type: 'add', step: 1, midi: 60 }],
  ['add overlapping', { type: 'add', step: 3, midi: 60, length: 9 }],
  ['add at end', { type: 'add', step: 31, midi: 60, length: 4 }],
  ['delete', { type: 'delete', ids: ['demo0', 'demo3'] }],
  ['move', { type: 'move', id: 'demo2', step: 7 }],
  ['move off end', { type: 'move', id: 'demo2', step: 99 }],
  ['resize', { type: 'resize', id: 'demo2', length: 20 }],
  ['nudge left', { type: 'nudge', ids: ['demo0', 'demo1'], dir: -1 }],
  ['nudge right', { type: 'nudge', ids: ['demo14'], dir: 1 }],
  ['bump', { type: 'bump', id: 'demo1', dir: 1 }],
  ['octave', { type: 'octave', id: 'demo1', dir: -1 }],
  ['setPitch', { type: 'setPitch', id: 'demo1', midi: 70 }],
  ['split', { type: 'split', id: 'demo8' }],
  ['merge', { type: 'merge', id: 'demo1' }],
  ['setGrid', { type: 'setGrid', grid: 8 }],
  ['requantize', { type: 'requantize', grid: 8 }],
  ['halfTime', { type: 'halfTime' }],
  ['doubleTime', { type: 'doubleTime' }],
  ['transpose', { type: 'transpose', semis: 5 }],
  ['transposeDiatonic', { type: 'transposeDiatonic', steps: 2 }],
  ['setKey move', { type: 'setKey', tonic: 2, scale: 'dorian', moveNotes: true }],
  ['setKey relabel', { type: 'setKey', tonic: 2, scale: 'major', moveNotes: false }],
  ['fixOutOfKey', { type: 'fixOutOfKey' }],
  ['setBpm', { type: 'setBpm', bpm: 500 }],
  ['setBars 1', { type: 'setBars', bars: 1 }],
  ['setBars 4', { type: 'setBars', bars: 4 }],
  ['pin', { type: 'pin', id: 'demo0', pos: { string: 1, fret: 0 } }],
  ['unpin', { type: 'unpin', id: 'demo0' }],
  ['setRegion', { type: 'setRegion', region: { mode: 'anchor', fret: 5 } }],
  ['setPower', { type: 'setPower', power: 'r5' }],
  ['setTuning', { type: 'setTuning', tuning: { name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] } }],
  ['setInstrument', { type: 'setInstrument', instrument: 'drive' }],
  ['rename', { type: 'rename', name: 'x' }],
  ['setVelocity', { type: 'setVelocity', id: 'demo0', velocity: 300 }],
];

describe('reduce invariants', () => {
  it.each(table)('%s keeps the riff normalized and does not mutate or touch updatedAt', (_n, a) => {
    const r = base();
    const snapshot = JSON.stringify(r);
    const out = reduce(r, a);
    assertNormalized(out);
    expect(JSON.stringify(r)).toBe(snapshot);
    expect(out.updatedAt).toBe(r.updatedAt);
  });
});

describe('notes', () => {
  it('add uses the grid unit and given id', () => {
    expect(gridUnit(16)).toBe(1);
    expect(gridUnit(8)).toBe(2);
    const r = reduce(newRiff({ grid: 8 }), { type: 'add', step: 4, midi: 50, id: 'q' });
    expect(r.notes[0]).toMatchObject({ id: 'q', step: 4, length: 2 });
  });
  it('adding on an occupied step replaces', () => {
    const r = reduce(base(), { type: 'add', step: 0, midi: 70, id: 'new' });
    expect(r.notes[0]).toMatchObject({ id: 'new', midi: 70 });
  });
  it('nudge clamps at 0 and moves by grid unit', () => {
    const r8 = { ...base(), grid: 8 as const };
    expect(reduce(r8, { type: 'nudge', ids: ['demo0'], dir: -1 }).notes[0]!.step).toBe(0);
    const r = reduce(r8, { type: 'nudge', ids: ['demo1'], dir: 1 });
    expect(r.notes.find((n) => n.id === 'demo1')!.step).toBe(4);
  });
  it('resize clamps to the end', () => {
    const r = reduce(base(), { type: 'resize', id: 'demo14', length: 50 });
    expect(r.notes.at(-1)).toMatchObject({ step: 30, length: 2 });
  });
});

describe('pitch', () => {
  it('bump with snap goes to the next in-scale pitch', () => {
    const r = { ...base(), notes: [{ id: 'a', step: 0, length: 1, midi: 45, velocity: 90 }] }; // A
    expect(reduce(r, { type: 'bump', id: 'a', dir: 1 }).notes[0]!.midi).toBe(46);
    expect(reduce(r, { type: 'bump', id: 'a', dir: 1, snapToScale: true }).notes[0]!.midi).toBe(47); // B
    expect(reduce(r, { type: 'bump', id: 'a', dir: -1, snapToScale: true }).notes[0]!.midi).toBe(43); // G
  });
  it('octave and canOctave', () => {
    const r = base();
    expect(canOctave(r, 1, 28, 88)).toBe(true);
    expect(canOctave(r, -1, 40, 88)).toBe(false);
    expect(reduce(r, { type: 'octave', id: 'demo0', dir: 1 }).notes[0]!.midi).toBe(57);
  });
});

describe('split / merge', () => {
  it('round-trips', () => {
    const r = base();
    const orig = r.notes.find((n) => n.id === 'demo8')!; // length 4
    const s = reduce(r, { type: 'split', id: 'demo8', newId: 'half' });
    expect(s.notes.filter((n) => n.midi === orig.midi && n.step >= 16 && n.step < 20)).toHaveLength(2);
    const m = reduce(s, { type: 'merge', id: 'demo8' });
    expect(m.notes.map(strip)).toEqual(r.notes.map(strip));
  });
  it('cannot split a 1-step note', () => {
    const r = { ...base(), notes: [{ id: 'a', step: 0, length: 1, midi: 45, velocity: 90 }] };
    expect(reduce(r, { type: 'split', id: 'a' })).toEqual(r);
  });
  it('merge with no next note is a no-op', () => {
    const r = base();
    expect(reduce(r, { type: 'merge', id: 'demo14' }).notes).toEqual(r.notes);
  });
});

describe('timing', () => {
  it('setBpm leaves notes unchanged and clamps', () => {
    const r = base();
    const o = reduce(r, { type: 'setBpm', bpm: 500 });
    expect(o.bpm).toBe(300);
    expect(o.notes).toEqual(r.notes);
  });
  it('requantize from capture.raw to grid 8 puts onsets on even steps', () => {
    const stepSec = 60 / 120 / 4;
    const raw = [0, 1, 3, 5, 8, 11].map((s, i) => ({ start: s * stepSec + 0.004, end: (s + 1.2) * stepSec, midi: 45.2 + i, velocity: 0.8 }));
    const r = newRiff({ bpm: 120, grid: 16, capture: { raw, bpm: 120 } });
    const o = reduce(r, { type: 'requantize', grid: 8 });
    expect(o.grid).toBe(8);
    expect(o.notes.length).toBeGreaterThan(0);
    expect(o.notes.every((n) => n.step % 2 === 0)).toBe(true);
    expect(o.notes.every((n) => Number.isInteger(n.midi))).toBe(true);
    assertNormalized(o);
  });
  it('requantize without capture snaps existing notes', () => {
    const r = { ...base(), notes: [{ id: 'a', step: 3, length: 3, midi: 45, velocity: 90 }] };
    const o = reduce(r, { type: 'requantize', grid: 8 });
    expect(o.notes[0]).toMatchObject({ id: 'a', step: 4, length: 4 });
  });
  it('halfTime / doubleTime', () => {
    const r = base();
    const h = reduce(r, { type: 'halfTime' });
    expect(h.bars).toBe(4);
    expect(h.notes.map((n) => n.step)).toEqual(r.notes.map((n) => n.step * 2));
    const d = reduce(h, { type: 'doubleTime' });
    expect(d.bars).toBe(2);
    expect(d.notes.map(strip)).toEqual(r.notes.map(strip));
  });
  it('halfTime at 8 bars drops overflow', () => {
    const r = newRiff({ bars: 8, notes: [{ id: 'a', step: 0, length: 2, midi: 45, velocity: 90 }, { id: 'b', step: 100, length: 2, midi: 45, velocity: 90 }] });
    const h = reduce(r, { type: 'halfTime' });
    expect(h.bars).toBe(8);
    expect(h.notes.map((n) => n.id)).toEqual(['a']);
  });
});

describe('key and transpose', () => {
  it('transposeDiatonic of an in-key riff stays in key', () => {
    for (const steps of [-9, -2, 1, 3, 7]) {
      const o = reduce(base(), { type: 'transposeDiatonic', steps });
      expect(o.notes.every((n) => inScale(n.midi, 9, 'minor'))).toBe(true);
    }
    const o = reduce(base(), { type: 'transposeDiatonic', steps: 1 });
    expect(o.notes[0]!.midi).toBe(47); // A -> B
    expect(reduce(base(), { type: 'transposeDiatonic', steps: 7 }).notes[0]!.midi).toBe(57);
  });
  it('transposeDiatonic snaps non-scale notes first and clears pins', () => {
    const r = { ...base(), notes: [{ id: 'a', step: 0, length: 1, midi: 46, velocity: 90, pin: { string: 1, fret: 1 } }] }; // A# -> A -> B
    const o = reduce(r, { type: 'transposeDiatonic', steps: 1 });
    expect(o.notes[0]!.midi).toBe(47);
    expect(o.notes[0]!.pin).toBeUndefined();
  });
  it('transpose shifts notes, key and pins', () => {
    const r = {
      ...base(),
      maxFret: 12,
      notes: [
        { id: 'a', step: 0, length: 1, midi: 45, velocity: 90, pin: { string: 1, fret: 0 } },
        { id: 'b', step: 2, length: 1, midi: 57, velocity: 90, pin: { string: 1, fret: 12 } },
      ],
    };
    const o = reduce(r, { type: 'transpose', semis: 2 });
    expect(o.key.tonic).toBe(11);
    expect(o.notes[0]).toMatchObject({ midi: 47, pin: { string: 1, fret: 2 } });
    expect(o.notes[1]!.midi).toBe(59);
    expect(o.notes[1]!.pin).toBeUndefined();
    const down = reduce(r, { type: 'transpose', semis: -1 });
    expect(down.notes[0]!.pin).toBeUndefined();
    expect(down.key.tonic).toBe(8);
  });
  it('setKey moveNotes uses the smallest interval; relabel does not move', () => {
    const r = base();
    const up = reduce(r, { type: 'setKey', tonic: 2, scale: 'minor', moveNotes: true }); // A->D = +5
    expect(up.notes[0]!.midi).toBe(50);
    expect(up.key.tonic).toBe(2);
    const far = reduce(r, { type: 'setKey', tonic: 3, scale: 'minor', moveNotes: true }); // A->Eb = -6
    expect(far.notes[0]!.midi).toBe(39);
    const rel = reduce(r, { type: 'setKey', tonic: 0, scale: 'major', moveNotes: false });
    expect(rel.notes).toEqual(r.notes);
    expect(rel.key).toEqual({ tonic: 0, scale: 'major' });
  });
  it('fixOutOfKey snaps to the nearest in-scale pitch, ties down', () => {
    const mk = (midi: number): Riff => ({ ...base(), notes: [{ id: 'a', step: 0, length: 1, midi, velocity: 90 }] });
    // A minor: 46 (A#) between 45 and 47 -> tie, down = 45
    expect(reduce(mk(46), { type: 'fixOutOfKey' }).notes[0]!.midi).toBe(45);
    // 49 (C#): 48 and 50 -> down 48
    expect(reduce(mk(49), { type: 'fixOutOfKey' }).notes[0]!.midi).toBe(48);
    expect(reduce(mk(47), { type: 'fixOutOfKey' }).notes[0]!.midi).toBe(47);
  });
});

describe('setup', () => {
  it('setTuning clears pins; pin/unpin', () => {
    let r = reduce(base(), { type: 'pin', id: 'demo0', pos: { string: 1, fret: 0 } });
    expect(r.notes[0]!.pin).toEqual({ string: 1, fret: 0 });
    r = reduce(r, { type: 'setTuning', tuning: { name: 'D', strings: [38, 43, 48, 53, 57, 62] } });
    expect(r.notes.every((n) => !n.pin)).toBe(true);
    r = reduce(reduce(r, { type: 'pin', id: 'demo0', pos: { string: 1, fret: 0 } }), { type: 'unpin', id: 'demo0' });
    expect(r.notes[0]!.pin).toBeUndefined();
  });
  it('setBars shrinking drops notes beyond the end', () => {
    const o = reduce(base(), { type: 'setBars', bars: 1 });
    expect(o.notes.every((n) => n.step < 16)).toBe(true);
  });
});
