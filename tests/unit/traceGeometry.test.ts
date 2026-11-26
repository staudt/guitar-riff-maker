import { describe, expect, it } from 'vitest';
import { newRiff } from '../../src/model/riff';
import { snapEnd, snapMove, traceBounds, traceSegments, unclaimedSpanAt } from '../../src/ui/traceGeometry';
import { getRollStepX, midiToRowPos, pxPerStep, setRollStepX } from '../../src/ui/rollGeometry';

// 10 ms hop. Points 0-9 = 60 (ticks 0-9), 10-19 = 64 (ticks 10-19), 20 null, 21-29 = 67 (unclaimed).
const midi: (number | null)[] = [
  ...Array<number>(10).fill(60),
  ...Array<number>(10).fill(64),
  null,
  ...Array<number>(9).fill(67),
];
const base = () =>
  newRiff({
    timing: 'free',
    span: 100,
    trace: { hop: 0.01, start: 0, midi },
    notes: [
      { id: 'a', step: 0, length: 10, midi: 60, velocity: 90, src: { step: 0, length: 10, midi: 60 } },
      { id: 'b', step: 10, length: 10, midi: 64, velocity: 90, src: { step: 10, length: 10, midi: 64 } },
    ],
  });

describe('traceSegments', () => {
  it('splits by owning note and at nulls', () => {
    const segs = traceSegments(base());
    expect(segs.map((s) => [s.claimed, s.noteId, s.points.length])).toEqual([
      [true, 'a', 10],
      [true, 'b', 10],
      [false, undefined, 9],
    ]);
  });

  it('moving a note moves exactly its segment', () => {
    const r = base();
    const before = traceSegments(r);
    const moved = { ...r, notes: r.notes.map((n) => (n.id === 'b' ? { ...n, step: n.step + 3, midi: n.midi + 2 } : n)) };
    const after = traceSegments(moved);
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    after[1]!.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[1]!.points[i]!.x + 3);
      expect(p.y).toBeCloseTo(before[1]!.points[i]!.y + 2);
    });
  });

  it('draws everything dim and untouched when no note has src', () => {
    const r = { ...base(), notes: base().notes.map(({ src: _s, ...n }) => n) };
    const segs = traceSegments(r);
    expect(segs.every((s) => !s.claimed)).toBe(true);
    expect(segs[0]!.points[0]).toEqual({ x: 0, y: 60 });
  });

  it('uses stepSeconds for grid riffs with a trace', () => {
    // 96 bpm -> 0.15625 s per step; hop 0.15625 -> one point per step.
    const r = newRiff({ bpm: 96, trace: { hop: 0.15625, start: 0, midi: [60, 61, 62] } });
    expect(traceSegments(r)[0]!.points.map((p) => p.x)).toEqual([0, 1, 2]);
  });

  it('finds an unclaimed span with rounded median pitch, and bounds', () => {
    const r = base();
    const s = unclaimedSpanAt(r, 25)!;
    expect(s).toEqual({ step: 21, length: 9, midi: 67 });
    expect(unclaimedSpanAt(r, 5)).toBeNull();
    expect(traceBounds(r)).toEqual([0, 10, 10, 20, 21, 30]);
    expect(traceBounds(r, 'a')).toEqual([10, 20, 21, 30]);
  });
});

describe('snapping', () => {
  it('snaps move edges to bounds within tol, else by unit', () => {
    expect(snapMove(0, 10, 12.4, 5, [], 4)).toBe(10);
    expect(snapMove(0, 10, 12.4, 5, [13], 4)).toBe(13);
    expect(snapMove(0, 10, 12.4, 5, [26], 4)).toBe(16); // end edge 22.4 -> 26 is out of tol; falls to bound? 3.6 <= 4 so end snaps
    expect(snapMove(0, 10, 12.4, 5, [40], 4)).toBe(10);
  });
  it('snaps resize end', () => {
    expect(snapEnd(23, 5, [21], 4)).toBe(21);
    expect(snapEnd(23, 5, [], 4)).toBe(25);
  });
});

describe('roll geometry helpers', () => {
  it('scales and exposes the step mapper', () => {
    expect(pxPerStep({ timing: 'grid' }, 1)).toBe(24);
    expect(pxPerStep({ timing: 'free' }, 2)).toBeCloseTo(3.2);
    setRollStepX(2);
    expect(getRollStepX()(10)).toBe(60);
  });
  it('interpolates midi over visible rows', () => {
    expect(midiToRowPos([64, 62, 60], 63)).toBe(0.5);
    expect(midiToRowPos([64, 62, 60], 70)).toBe(0);
    expect(midiToRowPos([64, 62, 60], 50)).toBe(2);
  });
});
