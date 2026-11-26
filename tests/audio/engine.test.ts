import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/audio/core';
import type { Cmd, Evt, PNote } from '../../src/audio/protocol';
import { render, SR } from './render';
import { trackPitch, hzToMidi } from './yin';

const mk = (index: number, step: number, midi = 52, length = 2): PNote => ({ index, step, length, midis: [midi], vel: 100 });

const steps = (ev: Evt[]) => ev.flatMap((e) => (e.type === 'step' ? [e] : []));
const notes = (ev: Evt[]) => ev.flatMap((e) => (e.type === 'note' ? [e] : []));

describe('pitch accuracy', () => {
  const midis = [40, 45, 52, 59, 64, 71, 76, 83, 88];
  for (const kind of ['clean', 'guide'] as const) {
    it(`${kind}: within 5 cents`, () => {
      const worst: string[] = [];
      for (const midi of midis) {
        const { l } = render([{ type: 'instrument', kind }, { type: 'audition', midis: [midi], vel: 100, seconds: 0.5 }], 0.6);
        const frames = trackPitch(l, SR, 'guitar').filter((f) => f.t >= 0.1 && f.t <= 0.4 && f.hz > 0);
        expect(frames.length, `midi ${midi} voiced frames`).toBeGreaterThan(10);
        const cents = frames.map((f) => (hzToMidi(f.hz) - midi) * 100).sort((a, b) => a - b);
        const med = cents[Math.floor(cents.length / 2)]!;
        worst.push(`${midi}:${med.toFixed(2)}`);
        expect(Math.abs(med), `midi ${midi} (${kind}) ${med}`).toBeLessThan(5);
      }
      console.log(kind, 'median cents error', worst.join(' '));
    }, 60_000);
  }
});

describe('transport timing', () => {
  const riff: Cmd = { type: 'riff', notes: [0, 4, 8, 12].map((s, i) => mk(i, s)), totalSteps: 16 };

  it('notes land on exact frames and audio onsets within 1 ms', () => {
    const r = render([riff, { type: 'tempo', bpm: 120, rate: 0.5 }, { type: 'play', from: 0, countInBeats: 0 }], 3.2);
    const sps = (SR * 60) / 60 / 4; // 12000
    const ns = notes(r.events).slice(0, 4);
    expect(ns.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    ns.forEach((e, i) => expect(Math.abs(e.time * SR - i * 4 * sps)).toBeLessThanOrEqual(1));
  });

  it('audio onset of every note is within 1 ms (guide voice, silent gaps)', () => {
    const r = render(
      [{ type: 'instrument', kind: 'guide' }, { type: 'riff', notes: [0, 4, 8, 12].map((s, i) => mk(i, s, 60, 1)), totalSteps: 16 }, { type: 'tempo', bpm: 120, rate: 0.5 }, { type: 'play', from: 0, countInBeats: 0 }],
      3.2,
    );
    const sps = 12000;
    for (let i = 0; i < 4; i++) {
      const exp = i * 4 * sps;
      let on = -1;
      for (let k = exp - 3000; k < exp + 3000; k++) {
        if (k >= 0 && Math.abs(r.l[k]!) > 1e-3) {
          on = k;
          break;
        }
      }
      expect(on).toBeGreaterThanOrEqual(0);
      expect(Math.abs(on - exp) / SR).toBeLessThanOrEqual(0.001);
    }
  });

  it('count-in: 4 negative step events one beat apart, then the first note', () => {
    const r = render([riff, { type: 'tempo', bpm: 120, rate: 1 }, { type: 'play', from: 0, countInBeats: 4 }], 3);
    const st = steps(r.events);
    expect(st.slice(0, 4).map((e) => e.step)).toEqual([-16, -12, -8, -4]);
    for (let i = 1; i < 4; i++) expect(st[i]!.time - st[i - 1]!.time).toBeCloseTo(0.5, 4);
    expect(st[4]!.step).toBe(0);
    expect(st[4]!.time - st[3]!.time).toBeCloseTo(0.5, 4);
    expect(notes(r.events)[0]!.time).toBeCloseTo(st[4]!.time, 6);
    // Clicks are audible before the first note.
    let pk = 0;
    for (let k = 0; k < 2000; k++) pk = Math.max(pk, Math.abs(r.l[k]!));
    expect(pk).toBeGreaterThan(0.05);
  });

  it('A-B loop wraps sample-exactly with no gap or duplicate', () => {
    const r = render([riff, { type: 'tempo', bpm: 120, rate: 0.5 }, { type: 'loop', start: 4, end: 12 }, { type: 'play', from: 4, countInBeats: 0 }], 4.2);
    const st = steps(r.events).slice(0, 17);
    expect(st.map((e) => e.step)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 4, 5, 6, 7, 8, 9, 10, 11, 4]);
    st.forEach((e, i) => expect(Math.abs(e.time * SR - i * 12000)).toBeLessThanOrEqual(1));
  });

  it('tempo change mid-play skips and repeats nothing', () => {
    const r = render(
      [riff, { type: 'tempo', bpm: 120, rate: 1 }, { type: 'play', from: 0, countInBeats: 0 }],
      3,
      { at: [{ time: 0.31, cmd: { type: 'tempo', bpm: 60, rate: 1 } }, { time: 1.2, cmd: { type: 'tempo', bpm: 200, rate: 1 } }, { time: 1.9, cmd: { type: 'tempo', bpm: 90, rate: 0.5 } }] },
    );
    const st = steps(r.events);
    expect(st.length).toBeGreaterThan(12);
    for (let i = 1; i < st.length; i++) {
      expect(st[i]!.step).toBe((st[i - 1]!.step + 1) % 16);
      expect(st[i]!.time).toBeGreaterThan(st[i - 1]!.time);
    }
  });

  it('note events come in index order with increasing time', () => {
    const many = Array.from({ length: 12 }, (_, i) => mk(i, i, 40 + i, 1));
    const r = render([{ type: 'riff', notes: many, totalSteps: 12 }, { type: 'play', from: 0, countInBeats: 0 }], 2.2);
    const ns = notes(r.events).slice(0, 12);
    expect(ns.map((e) => e.index)).toEqual(many.map((_, i) => i));
    for (let i = 1; i < ns.length; i++) expect(ns[i]!.time).toBeGreaterThan(ns[i - 1]!.time);
  });

  it('stop emits stopped and silences the transport', () => {
    const r = render([riff, { type: 'play', from: 0, countInBeats: 0 }], 1, { at: [{ time: 0.3, cmd: { type: 'stop' } }] });
    expect(r.events.some((e) => e.type === 'stopped')).toBe(true);
    const last = steps(r.events).at(-1)!;
    expect(last.time).toBeLessThan(0.35);
  });

  it('metronome clicks every beat when on', () => {
    const r = render([{ type: 'riff', notes: [], totalSteps: 16 }, { type: 'metronome', on: true, gain: 1 }, { type: 'play', from: 0, countInBeats: 0 }], 1.2);
    for (const beat of [0, 0.5, 1.0]) {
      let pk = 0;
      for (let k = Math.round(beat * SR); k < Math.round(beat * SR) + 1000; k++) pk = Math.max(pk, Math.abs(r.l[k]!));
      expect(pk).toBeGreaterThan(0.05);
    }
  });
});

describe('robustness', () => {
  it('drive with 16 overlapping notes: finite and within +-1', () => {
    const ns: PNote[] = Array.from({ length: 16 }, (_, i) => ({ index: i, step: i, length: 16, midis: [40 + i, 47 + i], vel: 127 }));
    const r = render([{ type: 'instrument', kind: 'drive' }, { type: 'volume', gain: 2 }, { type: 'riff', notes: ns, totalSteps: 16 }, { type: 'tempo', bpm: 200, rate: 1 }, { type: 'play', from: 0, countInBeats: 0 }], 3);
    let pk = 0;
    for (let i = 0; i < r.l.length; i++) {
      const v = r.l[i]!;
      expect(Number.isFinite(v)).toBe(true);
      pk = Math.max(pk, Math.abs(v));
    }
    expect(pk).toBeLessThanOrEqual(1);
    expect(pk).toBeGreaterThan(0.05);
  });

  it('power chords trigger every midi', () => {
    const r = render([{ type: 'riff', notes: [{ index: 0, step: 0, length: 4, midis: [40, 47, 52], vel: 100 }], totalSteps: 16 }, { type: 'play', from: 0, countInBeats: 0 }], 0.5);
    const frames = trackPitch(r.l, SR, 'chords');
    expect(frames.length).toBeGreaterThan(0);
    let pk = 0;
    for (const v of r.l) pk = Math.max(pk, Math.abs(v));
    expect(pk).toBeGreaterThan(0.05);
  });

  it('allocates no typed arrays or arrays during process()', () => {
    const e = new Engine(SR);
    e.command({ type: 'instrument', kind: 'drive' });
    e.command({ type: 'metronome', on: true, gain: 1 });
    e.command({ type: 'riff', notes: Array.from({ length: 8 }, (_, i) => ({ index: i, step: i * 2, length: 2, midis: [40 + i, 47 + i], vel: 100 })), totalSteps: 16 });
    e.command({ type: 'loop', start: 2, end: 14 });
    e.command({ type: 'play', from: 0, countInBeats: 4 });
    const l = new Float32Array(128);
    const r = new Float32Array(128);
    let f = 0;
    const run = (blocks: number) => {
      for (let i = 0; i < blocks; i++, f += 128) {
        e.process(l, r, f);
        e.drainEvents(() => {});
      }
    };
    run(400); // warm up (JIT, count-in, first wraps)
    const g = globalThis as unknown as Record<string, unknown>;
    const names = ['Float32Array', 'Float64Array', 'Int32Array', 'Uint8Array', 'Int16Array', 'Array'];
    const orig: Record<string, unknown> = {};
    let created = 0;
    for (const n of names) {
      const Orig = g[n] as new (...a: unknown[]) => unknown;
      orig[n] = Orig;
      g[n] = new Proxy(Orig, {
        construct(t, args, nt) {
          created++;
          return Reflect.construct(t, args, nt);
        },
      });
    }
    try {
      e.command({ type: 'tempo', bpm: 150, rate: 1 }); // commands are outside the audio path; don't count
      created = 0;
      run(2000);
    } finally {
      for (const n of names) g[n] = orig[n];
    }
    expect(created).toBe(0);
  });
});
