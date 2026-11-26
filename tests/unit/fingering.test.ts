import { describe, expect, it } from 'vitest';
import { fingeringFor } from '../../src/model/fingering';
import { demoRiff } from '../../src/model/demo';
import { reduce } from '../../src/model/edit';

const pitchOf = (tuning: number[], p: { string: number; fret: number }) => tuning[p.string]! + p.fret;

describe('fingeringFor', () => {
  const r = demoRiff();

  it('fingers every note at its own pitch', () => {
    const f = fingeringFor(r);
    expect(f.pos).toHaveLength(r.notes.length);
    r.notes.forEach((n, i) => expect(pitchOf(r.tuning.strings, f.pos[i]![0]!)).toBe(n.midi));
  });

  it('auto (-1) picks the cheapest region; other choices keep pitches but move frets', () => {
    const f = fingeringFor(r);
    const min = Math.min(...f.options.map((o) => o.cost));
    expect(f.options[f.choice]!.cost).toBe(min);
    expect(f.options.length).toBeGreaterThan(1);
    const other = (f.choice + 1) % f.options.length;
    const g = fingeringFor(reduce(r, { type: 'setRegion', region: { mode: 'auto', choice: other } }));
    expect(g.pos.map((p) => p[0])).not.toEqual(f.pos.map((p) => p[0]));
    r.notes.forEach((n, i) => expect(pitchOf(r.tuning.strings, g.pos[i]![0]!)).toBe(n.midi));
    const anchors = f.options.map((o) => o.anchor);
    expect([...anchors].sort((a, b) => a - b)).toEqual(anchors);
  });

  it('power mode returns root+5th shapes', () => {
    const f = fingeringFor(reduce(r, { type: 'setPower', power: 'r5' }));
    f.pos.forEach((shape, i) => {
      expect(shape).toHaveLength(2);
      expect(pitchOf(r.tuning.strings, shape[1]!) - pitchOf(r.tuning.strings, shape[0]!)).toBe(7);
      expect(pitchOf(r.tuning.strings, shape[0]!)).toBe(r.notes[i]!.midi);
    });
  });

  it('anchor mode stays near the requested fret', () => {
    const f = fingeringFor(reduce(r, { type: 'setRegion', region: { mode: 'anchor', fret: 7 } }));
    expect(Math.abs(f.anchor - 7)).toBeLessThanOrEqual(3);
  });

  it('demo riff: cheapest fingering has no hand shift, plays G3 open and stays in frets 0-3', () => {
    // Changed: the old cheapest fingering put G3 at D:5, sliding along the D string.
    const f = fingeringFor(r);
    expect(new Set(f.hands).size).toBe(1);
    const frets = f.pos.map((p) => p[0]!.fret);
    expect(Math.max(...frets)).toBeLessThanOrEqual(3);
    r.notes.forEach((n, i) => {
      if (n.midi === 55) expect(f.pos[i]![0]).toEqual({ string: 3, fret: 0 });
    });
  });

  it('demo riff: the 5th-position option stays in frets 5-8 on strings E/A/D', () => {
    const f = fingeringFor(r);
    const i = f.options.findIndex((o) => o.anchor >= 4 && o.anchor <= 6);
    expect(i).toBeGreaterThanOrEqual(0);
    const g = fingeringFor(reduce(r, { type: 'setRegion', region: { mode: 'auto', choice: i } }));
    for (const [p] of g.pos) {
      expect(p!.fret).toBeGreaterThanOrEqual(5);
      expect(p!.fret).toBeLessThanOrEqual(8);
      expect(p!.string).toBeLessThanOrEqual(2);
    }
  });
});

describe('position options', () => {
  it('drops implausible positions (e.g. sliding the riff along one string)', () => {
    const f = fingeringFor(demoRiff());
    expect(f.options.map((o) => o.anchor)).toEqual([1, 5]);
  });
});
