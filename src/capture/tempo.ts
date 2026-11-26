// Automatic tempo + grid detection for free-recorded (no metronome) monophonic riffs.
import type { GridNote, RawNote } from './types';

/** `steps`: 16th-step of each input onset (in start order), relative to `offset`. */
export type TempoFit = { bpm: number; grid: 8 | 16; offset: number; score: number; confidence: number; steps?: number[] };
export type AutoRiff = { notes: GridNote[]; bpm: number; grid: 8 | 16; bars: number; offset: number; confidence: number };

const DEFAULT_FIT: TempoFit = { bpm: 100, grid: 8, offset: 0, score: 0, confidence: 0.05 };

/** Pre-tempo cleanup: round pitch, merge same-pitch fragments, drop sandwiched glitches. */
export function cleanNotes(notes: RawNote[]): RawNote[] {
  const sorted = notes
    .filter((n) => Number.isFinite(n.start) && Number.isFinite(n.end) && Number.isFinite(n.midi))
    .map((n) => ({ ...n, midi: Math.round(n.midi) }))
    .sort((a, b) => a.start - b.start);
  const merge = (list: RawNote[]): RawNote[] => {
    const out: RawNote[] = [];
    for (const n of list) {
      const prev = out[out.length - 1];
      if (prev && prev.midi === n.midi && n.start - prev.end < 0.06) {
        prev.end = Math.max(prev.end, n.end);
        prev.velocity = Math.max(prev.velocity, n.velocity);
      } else out.push({ ...n });
    }
    return out;
  };
  let out = merge(sorted);
  // Glitches: very short notes with a neighbour on both sides (close in time).
  const kept = out.filter((n, i) => {
    if (n.end - n.start >= 0.05) return true;
    const p = out[i - 1];
    const q = out[i + 1];
    return !(p && q && n.start - p.end < 0.1 && q.start - n.end < 0.1);
  });
  if (kept.length !== out.length) out = merge(kept);
  return out;
}

/** Scoring constants (exported for tuning tests only). */
export const TUNE = { tau: 0.0193, errW: 0.749, c8: 0.164, c16: 0.307, prior: 3.24, sigma: 0.3925, durW: 0.26, phaseW: 17.2, coll: 4, ioi: 0.73, i1: 0.72, i3: 0.504, i5: 2.1 };
const huber = (x: number) => (x < 1 ? x * x : 2 * x - 1);

/** Complexity of landing on a 16th-step: quarter free, 8th cheap, odd 16th dearer. */
function stepCost(step: number): number {
  const m = ((step % 4) + 4) % 4;
  if (m === 0) return step % 8 === 0 ? 0 : 0.05;
  if (m === 2) return TUNE.c8;
  return TUNE.c16;
}

/** Cost of an inter-onset interval of d 16th-steps: 4/8 free, 2/6 cheap, 1/3 dearer, 5/7/9... dearest. */
function ioiCost(d: number): number {
  let c = TUNE.ioi * Math.log(d);
  if (d % 4 === 0) return c;
  if (d % 2 === 0) return c + TUNE.c8 * 0.5;
  if (d === 1) return c + TUNE.i1;
  if (d === 3) return c + TUNE.i3;
  return c + TUNE.i5;
}

type Cand = { bpm: number; phase: number; score: number };

const ioiTable: number[] = [];
function ioiCostCached(d: number): number {
  if (d >= 64) return ioiCost(d);
  let v = ioiTable[d];
  if (v === undefined) { v = ioiCost(d); ioiTable[d] = v; }
  return v;
}
const stepCostCache: number[] = [];
function stepCostCached(step: number): number {
  if (step >= 512) return stepCost(step);
  let v = stepCostCache[step];
  if (v === undefined) { v = stepCost(step); stepCostCache[step] = v; }
  return v;
}

// Scratch buffers for the Viterbi pass (resized on demand).
let scratch = { f: new Float64Array(0), c0: new Float64Array(0), c1: new Float64Array(0), back: new Uint8Array(0) };

/**
 * Viterbi over the two nearest steps of each onset (floor/ceil): timing error + metrical cost per onset,
 * interval cost between neighbours. Returns the total cost and, when `want`, the chosen steps.
 */
function assign(onsets: number[], phase: number, stepSec: number, want: boolean): { cost: number; steps: number[] } {
  const n = onsets.length;
  if (scratch.f.length < n) scratch = { f: new Float64Array(n), c0: new Float64Array(n), c1: new Float64Array(n), back: new Uint8Array(n * 2) };
  const { f: stepsA, c0: cost0, c1: cost1, back } = scratch;
  const inv = 1 / stepSec;
  const tauInv = 1 / TUNE.tau;
  for (let i = 0; i < n; i++) {
    const t = onsets[i]! - phase;
    const fl = Math.max(0, Math.floor(t * inv));
    stepsA[i] = fl;
    cost0[i] = huber(Math.abs(t - fl * stepSec) * tauInv) * TUNE.errW + stepCostCached(fl);
    cost1[i] = huber(Math.abs(t - (fl + 1) * stepSec) * tauInv) * TUNE.errW + stepCostCached(fl + 1);
  }
  let b0 = cost0[0]!;
  let b1 = cost1[0]!;
  for (let i = 1; i < n; i++) {
    const fp = stepsA[i - 1]!;
    const fc = stepsA[i]!;
    let nb0 = 0;
    let nb1 = 0;
    for (let c = 0; c < 2; c++) {
      const d0 = fc + c - fp;
      const d1 = d0 - 1;
      const v0 = b0 + (d0 <= 0 ? TUNE.coll : ioiCostCached(d0));
      const v1 = b1 + (d1 <= 0 ? TUNE.coll : ioiCostCached(d1));
      const p = v1 < v0 ? 1 : 0;
      const v = (p ? v1 : v0) + (c === 0 ? cost0[i]! : cost1[i]!);
      back[i * 2 + c] = p;
      if (c === 0) nb0 = v; else nb1 = v;
    }
    b0 = nb0;
    b1 = nb1;
  }
  let c = b0 <= b1 ? 0 : 1;
  const total = c === 0 ? b0 : b1;
  const steps: number[] = [];
  if (want) {
    steps.length = n;
    for (let i = n - 1; i >= 0; i--) {
      steps[i] = stepsA[i]! + c;
      c = back[i * 2 + c]!;
    }
  }
  return { cost: total, steps };
}

function evaluate(onsets: number[], lens: number[], bpm: number, phase: number): number {
  const stepSec = 60 / bpm / 4;
  let s = assign(onsets, phase, stepSec, false).cost;
  // duration evidence: sustained notes should map to integer steps (loose tolerance)
  const minLen = 1.6 * stepSec;
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i]!;
    if (len > minLen) {
      const ls = len / stepSec;
      const e = Math.abs(ls - Math.round(ls)) * stepSec;
      s += TUNE.durW * huber(e / 0.06);
    }
  }
  return s;
}

export function estimateTempo(
  notes: RawNote[],
  opts: { minBpm?: number; maxBpm?: number; hintBpm?: number } = {},
): TempoFit {
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 180;
  const hint = opts.hintBpm;
  ioiTable.length = 0;
  stepCostCache.length = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  if (sorted.length < 3 && !hint) return { ...DEFAULT_FIT, offset: sorted[0]?.start ?? 0 };
  if (sorted.length === 0) return { ...DEFAULT_FIT, bpm: hint ?? 100 };
  const t0 = sorted[0]!.start;
  const onsets = sorted.map((n) => n.start - t0);
  const lens = sorted.map((n) => n.end - n.start);

  const lo = hint ? hint * 0.97 : minBpm;
  const hi = hint ? hint * 1.03 : maxBpm;
  const coarse = hint ? 0.1 : 0.4;
  const phasesC: number[] = [];
  const pr = hint ? 0.12 : 0.06;
  for (let p = -pr; p <= pr + 1e-9; p += hint ? 0.02 : 0.01) phasesC.push(p);
  const priorTerm = (bpm: number) => (hint ? 0 : (Math.log(bpm / 100) ** 2) / (2 * TUNE.sigma ** 2) * TUNE.prior);
  const scan = (bpm: number, phases: number[]): Cand => {
    let bestC: Cand | null = null;
    for (const phase of phases) {
      const s = evaluate(onsets, lens, bpm, phase) + priorTerm(bpm) + Math.abs(phase) * TUNE.phaseW;
      if (!bestC || s < bestC.score) bestC = { bpm, phase, score: s };
    }
    return bestC!;
  };
  const perBpm: Cand[] = [];
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += coarse) perBpm.push(scan(bpm, phasesC));
  // Refine the best few local minima on a finer bpm/phase lattice.
  const order = perBpm
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.score <= (perBpm[i - 1]?.score ?? Infinity) && c.score <= (perBpm[i + 1]?.score ?? Infinity))
    .sort((x, y) => x.c.score - y.c.score)
    .slice(0, 6);
  for (const { c, i } of order) {
    let bestR = c;
    const fine: number[] = [];
    for (let p = Math.max(-pr, c.phase - 0.01); p <= Math.min(pr, c.phase + 0.01) + 1e-9; p += 0.0025) fine.push(p);
    for (let d = -coarse; d <= coarse + 1e-9; d += hint ? 0.025 : 0.05) {
      const r = scan(c.bpm + d, fine);
      if (r.score < bestR.score) bestR = r;
    }
    perBpm[i] = bestR;
  }
  let best = perBpm[0]!;
  for (const c of perBpm) if (c.score < best.score) best = c;

  // Second best among candidates not octave/identity related to the best.
  let second = Infinity;
  for (const c of perBpm) {
    const r = c.bpm / best.bpm;
    const related = [1, 2, 0.5, 1.5, 2 / 3].some((k) => Math.abs(r / k - 1) < 0.06);
    if (!related && c.score < second) second = c.score;
  }
  const margin = Number.isFinite(second) ? (second - best.score) / (1 + sorted.length * 0.5) : 0.5;
  let confidence = Math.max(0, Math.min(1, margin / 0.6));
  if (sorted.length < 5) confidence *= 0.5;
  if (hint) confidence = Math.max(confidence, 0.8);

  // Refine bpm/offset by least squares on the chosen step assignment.
  let bpm = best.bpm;
  let phase = best.phase;
  let steps = assign(onsets, phase, 60 / bpm / 4, true).steps;
  for (let it = 0; it < 4; it++) {
    const n = steps.length;
    const mx = steps.reduce((a, b) => a + b, 0) / n;
    const my = onsets.reduce((a, b) => a + b, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (steps[i]! - mx) ** 2;
      sxy += (steps[i]! - mx) * (onsets[i]! - my);
    }
    if (sxx < 1e-9) break;
    const ssNew = sxy / sxx;
    const phNew = my - ssNew * mx;
    const bpmNew = 60 / ssNew / 4;
    if (bpmNew < lo || bpmNew > hi || Math.abs(phNew) > (hint ? 0.12 : 0.06)) break;
    bpm = bpmNew;
    phase = phNew;
    steps = assign(onsets, phase, 60 / bpm / 4, true).steps;
  }

  // Grid: 8 when every onset sits on an even step.
  const grid: 8 | 16 = steps.every((st) => st % 2 === 0) ? 8 : 16;
  return { bpm, grid, offset: t0 + phase, score: best.score, confidence, steps };
}

export function autoQuantize(notes: RawNote[], opts: { hintBpm?: number; maxBars?: number } = {}): AutoRiff {
  const maxBars = opts.maxBars ?? 16;
  const cleaned = cleanNotes(notes);
  const fit = estimateTempo(cleaned, opts.hintBpm ? { hintBpm: opts.hintBpm } : {});
  if (cleaned.length === 0) return { notes: [], bpm: fit.bpm, grid: fit.grid, bars: 1, offset: fit.offset, confidence: 0 };
  const stepSec = 60 / fit.bpm / 4;
  const g = fit.grid === 8 ? 2 : 1;
  const maxStep = maxBars * 16;
  const byStep = new Map<number, GridNote & { dur: number }>();
  for (let i = 0; i < cleaned.length; i++) {
    const n = cleaned[i]!;
    const fitted = fit.steps?.[i];
    const step = fitted !== undefined ? fitted : Math.max(0, Math.round((n.start - fit.offset) / stepSec / g) * g);
    if (step >= maxStep) continue;
    const length = Math.max(g, Math.round((n.end - n.start) / stepSec / g) * g);
    const cand = { step, length, midi: Math.round(n.midi), velocity: n.velocity, dur: n.end - n.start };
    const prev = byStep.get(step);
    if (!prev || cand.dur > prev.dur) byStep.set(step, cand);
  }
  const out = [...byStep.values()].sort((a, b) => a.step - b.step);
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    const next = out[i + 1];
    if (next) {
      if (cur.step + cur.length > next.step || next.step - (cur.step + cur.length) < g) cur.length = next.step - cur.step;
    }
    cur.length = Math.max(1, Math.min(cur.length, maxStep - cur.step));
  }
  const last = out[out.length - 1];
  const bars = last ? Math.min(maxBars, Math.max(1, Math.ceil((last.step + last.length) / 16))) : 1;
  return {
    notes: out.map(({ dur: _d, ...n }) => n),
    bpm: fit.bpm,
    grid: fit.grid,
    bars,
    offset: fit.offset,
    confidence: fit.confidence,
  };
}
