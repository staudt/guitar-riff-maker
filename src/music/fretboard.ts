// Fretboard fingering. A Viterbi pass over (position, hand) states picks a playable fingering for a whole riff.
// `hand` = fret of the index finger (1..maxFret-span+1); the hand covers frets hand..hand+span-1. Open strings are always legal.
import type { Midi, Pos, Tuning } from './types';

/** Cost weights. Exported so tests (and tuning sessions) can reason about them. */
export const COST = {
  /** per fret of distance between the hand and the requested target region */
  wRegion: 2,
  /** per fret above the 12th */
  wHigh: 0.5,
  /** bonus (negative) for open strings when the target region is low (<= 3) */
  openBonus: -1,
  /** penalty for open strings when the target region is higher up */
  openPenalty: 10,
  /** extra open-string penalty per fret the target is above 3 */
  openPenaltyPerFret: 1,
  /** per fret of hand movement */
  wShift: 1.5,
  /** flat cost of any hand movement */
  wShiftFixed: 3,
  /** per string crossed */
  wString: 0.5,
  /** extra per string skipped over */
  wSkip: 1,
  /** per fret beyond 4 when jumping along one string */
  wJump: 1,
  /** power chords: per string above the second that the root sits on */
  wPowerRoot: 8,
} as const;

/** Marker for a note that cannot be played on this tuning/neck (outside its range). */
export const UNPLAYABLE: Pos = { string: -1, fret: -1 };
export const isPlayable = (p: Pos) => p.fret >= 0 && p.string >= 0;

export type FingerNote = { midi: Midi; pin?: Pos };
export type FingerOpts = { maxFret: number; target: number; span?: number };
export type Fingering = { pos: Pos[]; hands: number[]; cost: number };

/** Every place `midi` can be played; string 0 = lowest. Ordered low string first. */
export function positionsFor(midi: Midi, tuning: Tuning, maxFret: number): Pos[] {
  const out: Pos[] = [];
  tuning.strings.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret });
  });
  return out;
}

/** Other places to play the same pitch, excluding `current`. */
export function alternatives(midi: Midi, tuning: Tuning, maxFret: number, current?: Pos): Pos[] {
  return positionsFor(midi, tuning, maxFret).filter((p) => !current || p.string !== current.string || p.fret !== current.fret);
}

/** Frets shown for note `i`: the hand's window [lo, hi]. */
export function handWindow(hands: readonly number[], i: number, span = 4): [number, number] {
  const h = hands[i] ?? 1;
  return [h, h + span - 1];
}

/** A candidate state for one note: where the (root) note goes, plus the fretted extent of everything pressed. */
export type Cand = { pos: Pos; lo: number; hi: number; /** extra target-independent cost */ extra?: number };

/** Internal Viterbi over per-note candidate lists. Returns chosen candidate index and hand per note, plus cost. */
export function solve(cands: Cand[][], maxFret: number, span: number, target: number): { pick: number[]; hands: number[]; cost: number } | null {
  const n = cands.length;
  const H = Math.max(1, maxFret - span + 1);
  const INF = Infinity;
  const unary = (c: Cand, h: number): number => {
    if (c.hi >= 1 && (h > c.lo || h + span - 1 < c.hi)) return INF;
    let u = (c.extra ?? 0) + COST.wRegion * Math.abs(h - target) + COST.wHigh * Math.max(0, c.pos.fret - 12);
    if (c.pos.fret === 0) u += target <= 3 ? COST.openBonus : COST.openPenalty + COST.openPenaltyPerFret * (target - 3);
    return u;
  };
  const stringCost = (a: Pos, b: Pos): number => {
    const ds = Math.abs(a.string - b.string);
    let c = COST.wString * ds + COST.wSkip * Math.max(0, ds - 1);
    if (ds === 0) c += COST.wJump * Math.max(0, Math.abs(a.fret - b.fret) - 4);
    return c;
  };

  let prev = new Float64Array(0);
  const back: { c: Int16Array; h: Int16Array }[] = [];
  for (let i = 0; i < n; i++) {
    const cs = cands[i]!;
    const P = cs.length;
    const cur = new Float64Array(P * H).fill(INF);
    const bc = new Int16Array(P * H);
    const bh = new Int16Array(P * H);
    if (i === 0) {
      for (let c = 0; c < P; c++) for (let h = 1; h <= H; h++) cur[c * H + h - 1] = unary(cs[c]!, h);
    } else {
      const pcs = cands[i - 1]!;
      const PP = pcs.length;
      // g[c][h]: best cost of arriving at hand h from any hand with candidate c, including the shift cost.
      const g = new Float64Array(PP * H);
      const gh = new Int16Array(PP * H);
      for (let c = 0; c < PP; c++) {
        const o = c * H;
        // L1 distance transform with argmin tracking.
        for (let h = 0; h < H; h++) {
          g[o + h] = prev[o + h]!;
          gh[o + h] = h;
        }
        for (let h = 1; h < H; h++) {
          const v = g[o + h - 1]! + COST.wShift;
          if (v < g[o + h]!) {
            g[o + h] = v;
            gh[o + h] = gh[o + h - 1]!;
          }
        }
        for (let h = H - 2; h >= 0; h--) {
          const v = g[o + h + 1]! + COST.wShift;
          if (v < g[o + h]!) {
            g[o + h] = v;
            gh[o + h] = gh[o + h + 1]!;
          }
        }
        for (let h = 0; h < H; h++) {
          const stay = prev[o + h]!;
          const move = g[o + h]! + COST.wShiftFixed;
          if (stay <= move) {
            g[o + h] = stay;
            gh[o + h] = h;
          } else g[o + h] = move;
        }
      }
      const pcost = new Float64Array(PP);
      for (let c = 0; c < P; c++) {
        const cc = cs[c]!;
        for (let pc = 0; pc < PP; pc++) pcost[pc] = stringCost(pcs[pc]!.pos, cc.pos);
        // Legal hand range for this candidate.
        const hLo = cc.hi >= 1 ? Math.max(1, cc.hi - span + 1) : 1;
        const hHi = cc.hi >= 1 ? Math.min(H, cc.lo) : H;
        for (let h = hLo; h <= hHi; h++) {
          let best = INF;
          let bi = 0;
          for (let pc = 0; pc < PP; pc++) {
            const v = g[pc * H + h - 1]! + pcost[pc]!;
            if (v < best) {
              best = v;
              bi = pc;
            }
          }
          if (best === INF) continue;
          cur[c * H + h - 1] = best + unary(cc, h);
          bc[c * H + h - 1] = bi;
          bh[c * H + h - 1] = gh[bi * H + h - 1]!;
        }
      }
    }
    back.push({ c: bc, h: bh });
    prev = cur;
  }
  if (n === 0) return { pick: [], hands: [], cost: 0 };
  let best = INF;
  let bi = -1;
  for (let k = 0; k < prev.length; k++) {
    if (prev[k]! < best) {
      best = prev[k]!;
      bi = k;
    }
  }
  if (bi < 0) return null;
  const pick = new Array<number>(n);
  const hands = new Array<number>(n);
  let c = Math.floor(bi / H);
  let h = bi % H;
  for (let i = n - 1; i >= 0; i--) {
    pick[i] = c;
    hands[i] = h + 1;
    if (i > 0) {
      const b = back[i]!;
      const pc = b.c[c * H + h]!;
      const ph = b.h[c * H + h]!;
      c = pc;
      h = ph;
    }
  }
  return { pick, hands, cost: best };
}

/** Candidate lists for plain (single-note) fingering. `idx[k]` is the note index of `cands[k]`. */
export function singleCands(notes: readonly FingerNote[], tuning: Tuning, maxFret: number) {
  const cands: Cand[][] = [];
  const idx: number[] = [];
  notes.forEach((nt, i) => {
    const all = positionsFor(nt.midi, tuning, maxFret);
    if (all.length === 0) return;
    let ps = all;
    if (nt.pin) {
      const pin = nt.pin;
      const ok = all.find((p) => p.string === pin.string && p.fret === pin.fret);
      if (ok) ps = [ok];
    }
    cands.push(ps.map((pos) => ({ pos, lo: pos.fret, hi: pos.fret })));
    idx.push(i);
  });
  return { cands, idx };
}

/**
 * Fingering for a monophonic riff. Notes outside the neck's range get `UNPLAYABLE` ({string:-1,fret:-1});
 * they are skipped by the optimiser and inherit the neighbouring hand position.
 */
export function fingerRiff(notes: readonly FingerNote[], tuning: Tuning, opt: FingerOpts): Fingering {
  const { cands, idx } = singleCands(notes, tuning, opt.maxFret);
  const r = finish(notes.length, idx, cands, opt.maxFret, opt.span ?? 4, opt.target);
  return { pos: r.pos, hands: r.hands, cost: r.cost };
}

/** Solves and maps the subset of playable notes back onto all `total` notes, filling unplayable ones. */
export function finish(total: number, idx: number[], cands: Cand[][], maxFret: number, span: number, target: number) {
  const pos: Pos[] = new Array(total).fill(UNPLAYABLE);
  const hands: number[] = new Array(total).fill(-1);
  const chosen: (Cand | null)[] = new Array(total).fill(null);
  const sol = solve(cands, maxFret, span, target);
  if (sol) {
    idx.forEach((i, k) => {
      const c = cands[k]![sol.pick[k]!]!;
      chosen[i] = c;
      pos[i] = c.pos;
      hands[i] = sol.hands[k]!;
    });
  }
  const fallback = Math.max(1, Math.min(target, Math.max(1, maxFret - span + 1)));
  let last = -1;
  for (let i = 0; i < total; i++) {
    if (chosen[i]) last = hands[i]!;
    else hands[i] = last;
  }
  let next = -1;
  for (let i = total - 1; i >= 0; i--) {
    if (chosen[i]) next = hands[i]!;
    else if (hands[i]! < 0) hands[i] = next >= 0 ? next : fallback;
  }
  return { pos, hands, cost: sol ? sol.cost : 0, chosen };
}

/** Fingering cost ignoring the target-dependent terms (region, open-string bias), so options are comparable. */
export function sequenceCost(pos: readonly Pos[], hands: readonly number[]): number {
  let cost = 0;
  let pp: Pos | null = null;
  let ph = 0;
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i]!;
    if (!isPlayable(p)) continue;
    const h = hands[i]!;
    cost += COST.wHigh * Math.max(0, p.fret - 12);
    if (pp) {
      const dh = Math.abs(h - ph);
      if (dh) cost += COST.wShift * dh + COST.wShiftFixed;
      const ds = Math.abs(p.string - pp.string);
      cost += COST.wString * ds + COST.wSkip * Math.max(0, ds - 1);
      if (ds === 0) cost += COST.wJump * Math.max(0, Math.abs(p.fret - pp.fret) - 4);
    }
    pp = p;
    ph = h;
  }
  return cost;
}

/** Minimum distance in frets between the anchors of two offered regions. */
export const MIN_ANCHOR_GAP = 3;

export type Region<T = unknown> = { pos: Pos[]; hands: number[]; anchor: number; cost: number; extra?: T };

/** Shared sweep: run `run(target)` for targets 0..maxTarget, dedupe, keep the k cheapest, order by anchor. */
export function sweepRegions<T>(run: (target: number) => Fingering & { extra?: T }, k: number, maxTarget = 12): Region<T>[] {
  // Dedupe by fingering, keeping the cheapest hand assignment for each.
  const byKey = new Map<string, Region<T>>();
  for (let target = 0; target <= maxTarget; target++) {
    const f = run(target);
    const key = f.pos.map((p) => p.string + ':' + p.fret).join(',');
    const hs = f.hands.filter((_, i) => isPlayable(f.pos[i]!)).sort((a, b) => a - b);
    const anchor = hs.length ? hs[Math.floor((hs.length - 1) / 2)]! : 1;
    const r: Region<T> = { pos: f.pos, hands: f.hands, anchor, cost: sequenceCost(f.pos, f.hands), extra: f.extra };
    const old = byKey.get(key);
    if (!old || r.cost < old.cost) byKey.set(key, r);
  }
  const out = [...byKey.values()];
  // Greedy: cheapest first, then the cheapest whose anchor is >= MIN_ANCHOR_GAP frets from every chosen one.
  out.sort((a, b) => a.cost - b.cost);
  const top: Region<T>[] = [];
  for (const r of out) {
    if (top.length >= k) break;
    if (top.every((t) => Math.abs(t.anchor - r.anchor) >= MIN_ANCHOR_GAP)) top.push(r);
  }
  top.sort((a, b) => a.anchor - b.anchor || a.cost - b.cost);
  return top;
}

/** Up to k distinct fingerings in different neck regions, ordered up the neck by anchor. Drives "pos <>". */
export function bestRegions(
  notes: readonly FingerNote[],
  tuning: Tuning,
  opt: { maxFret: number; span?: number; k?: number },
): { pos: Pos[]; hands: number[]; anchor: number; cost: number }[] {
  return sweepRegions((target) => fingerRiff(notes, tuning, { maxFret: opt.maxFret, span: opt.span, target }), opt.k ?? 4, Math.max(12, opt.maxFret - (opt.span ?? 4))).map(
    ({ pos, hands, anchor, cost }) => ({ pos, hands, anchor, cost }),
  );
}
