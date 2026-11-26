// Lesson state and pure helpers for stepping through a riff's notes.
import { signal } from '@preact/signals';

export type LessonMode = 'play' | 'step';
export type LoopRange = { start: number; end: number };
type N = { step: number; length: number };

export const lessonMode = signal<LessonMode>('play');
/** Index into riff.notes of the note shown in step mode; -1 = none. */
export const lessonIndex = signal(-1);

/** Indices of notes inside the loop range (whole riff when end <= start). */
export function loopIndexes(notes: readonly N[], loop?: LoopRange): number[] {
  const out: number[] = [];
  const ranged = !!loop && loop.end > loop.start;
  notes.forEach((n, i) => {
    if (!ranged || (n.step >= loop!.start && n.step < loop!.end)) out.push(i);
  });
  return out;
}

/** Next note index after i within the loop range, wrapping to the first. -1 when there are none. */
export function nextIndex(notes: readonly N[], i: number, loop?: LoopRange): number {
  const idx = loopIndexes(notes, loop);
  if (!idx.length) return -1;
  return idx.find((k) => k > i) ?? idx[0]!;
}

/** Previous note index before i within the loop range, wrapping to the last. -1 when there are none. */
export function prevIndex(notes: readonly N[], i: number, loop?: LoopRange): number {
  const idx = loopIndexes(notes, loop);
  if (!idx.length) return -1;
  for (let k = idx.length - 1; k >= 0; k--) if (idx[k]! < i) return idx[k]!;
  return idx[idx.length - 1]!;
}

/** The note after `index` (loop-aware; last in loop -> first in loop). */
export const nextAfter = nextIndex;

/** Index of the note sounding at `step`, or -1. */
export function activeAt(notes: readonly N[], step: number): number {
  return notes.findIndex((n) => step >= n.step && step < n.step + n.length);
}
