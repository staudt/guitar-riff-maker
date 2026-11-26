// Undo/redo over whole-riff snapshots. Immutable; every function returns a new History.
import type { Riff } from './riff';

export const HISTORY_CAP = 100;
export const COALESCE_MS = 800;

export type History = {
  past: Riff[];
  present: Riff;
  future: Riff[];
  /** Coalescing bookkeeping for the last commit. */
  lastKey?: string;
  lastAt?: number;
};

export const createHistory = (initial: Riff): History => ({ past: [], present: initial, future: [] });

export function commit(h: History, riff: Riff, opts: { coalesceKey?: string; now?: number } = {}): History {
  if (riff === h.present) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey;
  const coalesce = key !== undefined && h.lastKey === key && h.lastAt !== undefined && now - h.lastAt < COALESCE_MS;
  const past = coalesce ? h.past : [...h.past, h.present].slice(-HISTORY_CAP);
  const next: History = { past, present: riff, future: [] };
  if (key !== undefined) {
    next.lastKey = key;
    next.lastAt = now;
  }
  return next;
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_CAP), present: next, future: rest };
}
