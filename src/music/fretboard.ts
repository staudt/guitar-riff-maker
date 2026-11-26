// Fretboard fingering. A Viterbi pass over (position, hand) states picks a playable fingering for a whole riff.
// `hand` = fret of the index finger (1..maxFret-span+1); the hand covers frets hand..hand+span-1. Open strings are always legal.
import type { Midi, Pos, Tuning } from './types';

/**
 * Cost weights. Exported so tests (and tuning sessions) can reason about them.
 * Philosophy: staying inside the 4-fret hand window and changing strings is cheap; moving the hand is expensive
 * (unless the player has time to do it); sliding far along one string is the most expensive of all.
 */
export const COST = {
  /** per fret of distance between the hand and the requested target region */
  wRegion: 2,
  /** per fret above the 12th */
  wHigh: 0.5,
  /** bonus (negative) for open strings when the target region is low (<= 3): an open string keeps the hand still */
  openBonus: -3,
  /** penalty for open strings when the target region is higher up */
  openPenalty: 10,
  /** extra open-string penalty per fret the target is above 3 */
  openPenaltyPerFret: 3,
  /** per fret of hand movement (before timing scale) */
  wShift: 2.5,
  /** flat cost of any hand movement (before timing scale) */
  wShiftFixed: 6,
  /** per string crossed (cheap: string changes are the preferred way to move) */
  wString: 0.5,
  /** extra per string skipped over */
  wSkip: 1,
  /** same string, per fret of distance beyond 2 (a stretch inside the window) */
  wStretch: 1,
  /** same string, per fret of distance beyond 3 (a jump: strongly discouraged when another string would do) */
  wJump: 4,
  /** per fret beyond 4 between two consecutive fretted notes on any strings (scaled by the shift timing factor) */
  wFar: 1.5,
  /** bonus (negative) for adjacent strings with |dfret| <= 2 between notes less than GRIP_IOI apart (arpeggio/grip feel) */
  wGrip: -1,
  /** bonus (negative) when 3 consecutive fast notes spell a major/minor triad or power-chord set on 3 adjacent strings within 3 frets */
  wTriad: -3,
  /** power chords: per string above the second that the root sits on */
  wPowerRoot: 8,
  /** shift cost multiplier after a rest or a long note (time to move) */
  shiftRelaxed: 0.25,
  /** shift cost multiplier in a fast passage (IOI < FAST_IOI) */
  shiftFast: 2,
} as const;

/** Timing thresholds in seconds. */
export const TIMING = {
  /** gap between the end of a note and the next onset that counts as a rest */
  restGap: 0.3,
  /** previous note at least this long gives time to shift */
  longNote: 0.4,
  /** onset-to-onset below this is a fast passage */
  fastIoi: 0.2,
  /** onset-to-onset below this makes adjacent-string placements feel like a grip/arpeggio */
  gripIoi: 0.35,
} as const;

/** Marker for a note that cannot be played on this tuning/neck (outside its range). */
export const UNPLAYABLE: Pos = { string: -1, fret: -1 };
export const isPlayable = (p: Pos) => p.fret >= 0 && p.string >= 0;

/** `start`/`end` in seconds are optional; without them every transition is treated as medium speed. */
export type FingerNote = { midi: Midi; pin?: Pos; start?: number; end?: number };
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
export type Cand = {
  pos: Pos;
  lo: number;
  hi: number;
  /** extra target-independent cost */
  extra?: number;
  /** note timing in seconds */
  t?: { start: number; end: number };
  midi?: Midi;
  /** index of this placement among the note's plain candidates (set by singleCands) */
  base?: number;
  /** second-order state: this variant assumes the previous note used plain candidate `link` (see withTriads) */
  link?: number;
  pPos?: Pos;
  pT?: { start: number; end: number };
  pMidi?: Midi;
  /** the previous/this/next notes spell a triad or power-chord pitch-class set */
  tri?: boolean;
};

/** Hand-shift cost multiplier for the transition between two notes, from their timing. 1 when unknown. */
export function shiftScale(a?: { start: number; end: number }, b?: { start: number; end: number }): number {
  if (!a || !b) return 1;
  if (b.start - a.end >= TIMING.restGap || a.end - a.start >= TIMING.longNote) return COST.shiftRelaxed;
  if (b.start - a.start < TIMING.fastIoi) return COST.shiftFast;
  return 1;
}

const isGripTime = (a?: { start: number }, b?: { start: number }) => !a || !b || b.start - a.start < TIMING.gripIoi;

/** Pairwise placement cost between consecutive notes (no hand shift term). `scale` is the shiftScale of the pair. */
export function pairCost(a: Pos, b: Pos, scale: number, grip: boolean): number {
  const ds = Math.abs(a.string - b.string);
  const df = Math.abs(a.fret - b.fret);
  let c = COST.wString * ds + COST.wSkip * Math.max(0, ds - 1);
  if (ds === 0) c += COST.wStretch * Math.max(0, df - 2) + COST.wJump * Math.max(0, df - 3);
  if (a.fret > 0 && b.fret > 0) c += COST.wFar * scale * Math.max(0, df - 4);
  if (grip && ds === 1 && df <= 2) c += COST.wGrip;
  return c;
}

/** True when three pitches spell a major/minor triad or a root+fifth set (any inversion/octave). */
export function isTriadSet(m: readonly [Midi, Midi, Midi]): boolean {
  const pcs = [...new Set(m.map((x) => ((x % 12) + 12) % 12))];
  if (pcs.length === 2) return ((pcs[1]! - pcs[0]! + 12) % 12 === 7) || ((pcs[0]! - pcs[1]! + 12) % 12 === 7);
  if (pcs.length !== 3) return false;
  return pcs.some((r) => {
    const rel = pcs.map((x) => (x - r + 12) % 12).sort((x, y) => x - y);
    return rel[1] === 3 || rel[1] === 4 ? rel[2] === 7 : false;
  });
}

/** Bonus (negative) when positions a,b,c sit on three adjacent strings within a 3-fret span. */
export function triadShapeBonus(a: Pos, b: Pos, c: Pos): number {
  const ss = [a.string, b.string, c.string].sort((x, y) => x - y);
  if (ss[1]! - ss[0]! !== 1 || ss[2]! - ss[1]! !== 1) return 0;
  const fs = [a.fret, b.fret, c.fret];
  return Math.max(...fs) - Math.min(...fs) <= 3 ? COST.wTriad : 0;
}

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
  const transCost = (a: Cand, b: Cand, scale: number): number => {
    let c = pairCost(a.pos, b.pos, scale, isGripTime(a.t, b.t));
    // Second-order term: a.link/pPos remember the note before `a`.
    if (a.tri && a.pPos && b.midi !== undefined && a.midi !== undefined && a.pMidi !== undefined && isGripTime(a.t, b.t) && isGripTime(a.pT, a.t))
      c += triadShapeBonus(a.pPos, a.pos, b.pos);
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
      const sc = shiftScale(pcs[0]?.t, cs[0]?.t);
      const wShift = COST.wShift * sc;
      const wFixed = COST.wShiftFixed * sc;
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
          const v = g[o + h - 1]! + wShift;
          if (v < g[o + h]!) {
            g[o + h] = v;
            gh[o + h] = gh[o + h - 1]!;
          }
        }
        for (let h = H - 2; h >= 0; h--) {
          const v = g[o + h + 1]! + wShift;
          if (v < g[o + h]!) {
            g[o + h] = v;
            gh[o + h] = gh[o + h + 1]!;
          }
        }
        for (let h = 0; h < H; h++) {
          const stay = prev[o + h]!;
          const move = g[o + h]! + wFixed;
          if (stay <= move) {
            g[o + h] = stay;
            gh[o + h] = h;
          } else g[o + h] = move;
        }
      }
      const pcost = new Float64Array(PP);
      for (let c = 0; c < P; c++) {
        const cc = cs[c]!;
        for (let pc = 0; pc < PP; pc++) pcost[pc] = cc.link !== undefined && pcs[pc]!.base !== cc.link ? INF : transCost(pcs[pc]!, cc, sc);
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

/**
 * Second-order grip support. A triad bonus depends on three consecutive placements, which a first-order Viterbi
 * cannot see. Rather than a k-best re-scoring pass, the middle note of every triad-shaped triple is expanded into
 * one variant per placement of the previous note (`link`); solve() only lets a variant follow the matching plain
 * candidate. That is an exact pair-state search, and it costs extra states only at the few notes where it matters.
 */
export function withTriads(cands: Cand[][]): Cand[][] {
  return cands.map((cs, k) => {
    const prev = cands[k - 1];
    const next = cands[k + 1];
    const a = prev?.[0]?.midi;
    const b = cs[0]?.midi;
    const c = next?.[0]?.midi;
    if (!prev || !next || a === undefined || b === undefined || c === undefined || !isTriadSet([a, b, c])) return cs;
    const out: Cand[] = [];
    for (const v of cs)
      for (const p of prev) out.push({ ...v, link: p.base, pPos: p.pos, pMidi: p.midi, pT: p.t, tri: true });
    return out;
  });
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
    const t = nt.start !== undefined && nt.end !== undefined ? { start: nt.start, end: nt.end } : undefined;
    cands.push(ps.map((pos, base) => ({ pos, lo: pos.fret, hi: pos.fret, midi: nt.midi, base, t })));
    idx.push(i);
  });
  return { cands: withTriads(cands), idx };
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
export function sequenceCost(pos: readonly Pos[], hands: readonly number[], times?: readonly ({ start: number; end: number } | undefined)[]): number {
  let cost = 0;
  let pp: Pos | null = null;
  let pt: { start: number; end: number } | undefined;
  let ph = 0;
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i]!;
    if (!isPlayable(p)) continue;
    const h = hands[i]!;
    const t = times?.[i];
    cost += COST.wHigh * Math.max(0, p.fret - 12);
    if (pp) {
      const sc = shiftScale(pt, t);
      const dh = Math.abs(h - ph);
      if (dh) cost += (COST.wShift * dh + COST.wShiftFixed) * sc;
      cost += pairCost(pp, p, sc, isGripTime(pt, t));
    }
    pp = p;
    pt = t;
    ph = h;
  }
  return cost;
}

/** Minimum distance in frets between the anchors of two offered regions. */
export const MIN_ANCHOR_GAP = 3;

export type Region<T = unknown> = { pos: Pos[]; hands: number[]; anchor: number; cost: number; extra?: T };

/** Shared sweep: run `run(target)` for targets 0..maxTarget, dedupe, keep the k cheapest, order by anchor. */
export function sweepRegions<T>(
  run: (target: number) => Fingering & { extra?: T },
  k: number,
  maxTarget = 12,
  times?: readonly ({ start: number; end: number } | undefined)[],
): Region<T>[] {
  // Dedupe by fingering, keeping the cheapest hand assignment for each.
  const byKey = new Map<string, Region<T>>();
  for (let target = 0; target <= maxTarget; target++) {
    const f = run(target);
    const key = f.pos.map((p) => p.string + ':' + p.fret).join(',');
    const hs = f.hands.filter((_, i) => isPlayable(f.pos[i]!)).sort((a, b) => a - b);
    const anchor = hs.length ? hs[Math.floor((hs.length - 1) / 2)]! : 1;
    const r: Region<T> = { pos: f.pos, hands: f.hands, anchor, cost: sequenceCost(f.pos, f.hands, times), extra: f.extra };
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
  return sweepRegions((target) => fingerRiff(notes, tuning, { maxFret: opt.maxFret, span: opt.span, target }), opt.k ?? 4, Math.max(12, opt.maxFret - (opt.span ?? 4)), timesOf(notes)).map(
    ({ pos, hands, anchor, cost }) => ({ pos, hands, anchor, cost }),
  );
}

/** Per-note timing for sequenceCost; undefined where a note has none. */
export const timesOf = (notes: readonly FingerNote[]) => notes.map((n) => (n.start !== undefined && n.end !== undefined ? { start: n.start, end: n.end } : undefined));
