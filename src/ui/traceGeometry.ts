// Pure geometry for the recorded pitch line drawn under the roll's notes.
import { stepSeconds, type Riff } from '../model/riff';

export type TracePoint = { x: number; y: number };
export type TraceSegment = { points: TracePoint[]; claimed: boolean; noteId?: string };

type Claim = { lo: number; hi: number; dx: number; dy: number; id: string };

/** Notes' src ranges (in ticks), sorted by start, as translation claims. */
function claimsOf(r: Pick<Riff, 'notes'>): Claim[] {
  const out: Claim[] = [];
  for (const n of r.notes) {
    if (!n.src) continue;
    out.push({ lo: n.src.step, hi: n.src.step + n.src.length, dx: n.step - n.src.step, dy: n.midi - n.src.midi, id: n.id });
  }
  return out.sort((a, b) => a.lo - b.lo);
}

function claimAt(claims: readonly Claim[], tick: number): Claim | undefined {
  let a = 0;
  let b = claims.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    const c = claims[m]!;
    if (tick < c.lo) b = m - 1;
    else if (tick >= c.hi) a = m + 1;
    else return c;
  }
  return undefined;
}

/**
 * The trace as polylines in (step, midi) space. A point whose time lies in a note's src range is
 * translated by that note's (step, midi) displacement; others are unclaimed and drawn as recorded.
 * Segments split at unvoiced points and wherever the owning note changes.
 */
export function traceSegments(r: Pick<Riff, 'notes' | 'trace' | 'timing' | 'bpm'>): TraceSegment[] {
  const t = r.trace;
  if (!t) return [];
  const sec = stepSeconds(r);
  const claims = claimsOf(r);
  const out: TraceSegment[] = [];
  let cur: TraceSegment | null = null;
  let curKey: string | undefined;
  for (let i = 0; i < t.midi.length; i++) {
    const m = t.midi[i];
    if (m === null || m === undefined || !Number.isFinite(m)) {
      cur = null;
      continue;
    }
    const tick = Math.round(((t.start + i * t.hop) / sec) * 1e6) / 1e6; // strip float noise so range edges are exact
    const c = claimAt(claims, tick);
    const key = c?.id;
    if (!cur || key !== curKey) {
      cur = c ? { points: [], claimed: true, noteId: c.id } : { points: [], claimed: false };
      curKey = key;
      out.push(cur);
    }
    cur.points.push({ x: tick + (c?.dx ?? 0), y: m + (c?.dy ?? 0) });
  }
  return out;
}

/** Min and max trace pitch (as recorded), or null when there is no voiced point. */
export function traceRange(r: Pick<Riff, 'trace'>): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of r.trace?.midi ?? []) {
    if (m === null || !Number.isFinite(m)) continue;
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return lo <= hi ? { lo, hi } : null;
}

export type SegmentSpan = { step: number; length: number; midi: number };

/** Integer tick span + rounded median pitch of a segment's points (point x = start tick of that point). */
export function segmentSpan(seg: TraceSegment, hopTicks: number): SegmentSpan {
  const first = seg.points[0]!;
  const last = seg.points[seg.points.length - 1]!;
  const step = Math.max(0, Math.round(first.x));
  const end = Math.max(step + 1, Math.round(last.x + hopTicks));
  const ys = seg.points.map((p) => p.y).sort((a, b) => a - b);
  const median = ys[Math.floor(ys.length / 2)] ?? first.y;
  return { step, length: end - step, midi: Math.round(median) };
}

/** The unclaimed segment whose time span (± tol ticks) contains `tick`, as a note-sized span. */
export function unclaimedSpanAt(r: Pick<Riff, 'notes' | 'trace' | 'timing' | 'bpm'>, tick: number, tol = 3): SegmentSpan | null {
  if (!r.trace) return null;
  const hopTicks = r.trace.hop / stepSeconds(r);
  let best: { s: SegmentSpan; d: number } | null = null;
  for (const seg of traceSegments(r)) {
    if (seg.claimed || seg.points.length === 0) continue;
    const s = segmentSpan(seg, hopTicks);
    const d = tick < s.step ? s.step - tick : tick > s.step + s.length ? tick - (s.step + s.length) : 0;
    if (d <= tol && (!best || d < best.d)) best = { s, d };
  }
  return best ? best.s : null;
}

/** Sorted step positions of every segment start/end (displayed, i.e. after translation), optionally skipping one note's segments. */
export function traceBounds(r: Pick<Riff, 'notes' | 'trace' | 'timing' | 'bpm'>, excludeId?: string): number[] {
  if (!r.trace) return [];
  const hopTicks = r.trace.hop / stepSeconds(r);
  const out: number[] = [];
  for (const seg of traceSegments(r)) {
    if (seg.points.length === 0 || (excludeId && seg.noteId === excludeId)) continue;
    out.push(seg.points[0]!.x, Math.round((seg.points[seg.points.length - 1]!.x + hopTicks) * 1e6) / 1e6);
  }
  return out.sort((a, b) => a - b);
}

/** Nearest bound within tol of `raw`, else null. */
export function nearestBound(raw: number, bounds: readonly number[], tol: number): number | null {
  let best: number | null = null;
  for (const b of bounds) if (Math.abs(b - raw) <= tol && (best === null || Math.abs(b - raw) < Math.abs(best - raw))) best = b;
  return best;
}

/**
 * New start step when dragging a note of `length` from `step0` by `dxSteps` (float): rounded delta by `unit`,
 * unless the start or end edge lands within `tol` of a bound, in which case that edge snaps to it.
 */
export function snapMove(step0: number, length: number, dxSteps: number, unit: number, bounds: readonly number[], tol: number): number {
  const plain = step0 + Math.round(dxSteps / unit) * unit;
  const rawStart = step0 + dxSteps;
  const bs = nearestBound(rawStart, bounds, tol);
  const be = nearestBound(rawStart + length, bounds, tol);
  const ds = bs === null ? Infinity : Math.abs(bs - rawStart);
  const de = be === null ? Infinity : Math.abs(be - (rawStart + length));
  if (ds === Infinity && de === Infinity) return plain;
  return Math.round(ds <= de ? bs! : be! - length);
}

/** New end step (exclusive) when dragging a note's right edge to raw position `rawEnd`. */
export function snapEnd(rawEnd: number, unit: number, bounds: readonly number[], tol: number): number {
  const b = nearestBound(rawEnd, bounds, tol);
  return b !== null ? Math.round(b) : Math.round(rawEnd / unit) * unit;
}
