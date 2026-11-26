// Power chords: root + fifth (+ octave) shapes on adjacent strings, for any tuning.
import { COST, finish, positionsFor, sweepRegions, timesOf } from './fretboard';
import type { Cand, FingerNote, Fingering, Region } from './fretboard';
import type { Midi, Pos, Tuning } from './types';

export type PowerKind = 'r5' | 'r58';
export type PowerFingering = Fingering & { shapes: Pos[][] };

/** Shape for a root on `root`: fifth on the next string up, octave two strings up. null if it does not fit. */
export function shape(root: Pos, tuning: Tuning, kind: PowerKind, maxFret: number): Pos[] | null {
  const open = tuning.strings;
  const s = root.string;
  const base = open[s];
  if (base === undefined || root.fret < 0 || root.fret > maxFret) return null;
  const out: Pos[] = [{ string: s, fret: root.fret }];
  const add = (ds: number, semis: number): boolean => {
    const o = open[s + ds];
    if (o === undefined) return false;
    const fret = root.fret + semis - (o - base);
    if (fret < 0 || fret > maxFret) return false;
    out.push({ string: s + ds, fret });
    return true;
  };
  if (!add(1, 7)) return null;
  if (kind === 'r58' && !add(2, 12)) return null;
  return out;
}

/** MIDI notes to play for a root note. */
export function expand(midi: Midi, kind: 'off' | PowerKind): Midi[] {
  if (kind === 'off') return [midi];
  return kind === 'r5' ? [midi, midi + 7] : [midi, midi + 7, midi + 12];
}

/** Like fingerRiff, but each note is a power chord. `pos` are the roots; `shapes` the full chord positions. */
export function fingerPower(
  notes: readonly FingerNote[],
  tuning: Tuning,
  kind: PowerKind,
  opt: { maxFret: number; target: number; span?: number },
): PowerFingering {
  const span = opt.span ?? 4;
  const cands: Cand[][] = [];
  const idx: number[] = [];
  const shapeOf = new Map<Cand, Pos[]>();
  notes.forEach((nt, i) => {
    let roots = positionsFor(nt.midi, tuning, opt.maxFret);
    if (nt.pin) {
      const pin = nt.pin;
      const ok = roots.filter((p) => p.string === pin.string && p.fret === pin.fret && shape(p, tuning, kind, opt.maxFret));
      if (ok.length) roots = ok;
    }
    const cs: Cand[] = [];
    for (const r of roots) {
      const sh = shape(r, tuning, kind, opt.maxFret);
      if (!sh) continue;
      let lo = Infinity;
      let hi = 0;
      for (const p of sh) {
        if (p.fret < 1) continue;
        lo = Math.min(lo, p.fret);
        hi = Math.max(hi, p.fret);
      }
      const c: Cand = { pos: r, lo: hi ? lo : 0, hi, extra: COST.wPowerRoot * Math.max(0, r.string - 1), midi: nt.midi, t: nt.start !== undefined && nt.end !== undefined ? { start: nt.start, end: nt.end } : undefined };
      shapeOf.set(c, sh);
      cs.push(c);
    }
    if (cs.length) {
      cands.push(cs);
      idx.push(i);
    }
  });
  const r = finish(notes.length, idx, cands, opt.maxFret, span, opt.target);
  const shapes = r.chosen.map((c) => (c ? shapeOf.get(c)! : []));
  return { pos: r.pos, hands: r.hands, cost: r.cost, shapes };
}

/** Distinct power-chord fingerings in different regions (see bestRegions). */
export function bestPowerRegions(
  notes: readonly FingerNote[],
  tuning: Tuning,
  kind: PowerKind,
  opt: { maxFret: number; span?: number; k?: number },
): (Region<Pos[][]> & { shapes: Pos[][] })[] {
  return sweepRegions<Pos[][]>((target) => {
    const f = fingerPower(notes, tuning, kind, { maxFret: opt.maxFret, span: opt.span, target });
    return { pos: f.pos, hands: f.hands, cost: f.cost, extra: f.shapes };
  }, opt.k ?? 4, Math.max(12, opt.maxFret - (opt.span ?? 4)), timesOf(notes)).map((r) => ({ ...r, shapes: r.extra ?? [] }));
}
