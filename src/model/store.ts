// Signals-backed editor state: history, selection and dispatch. UI reads `riff` and `selection`.
import { computed, signal } from '@preact/signals';
import { reduce, type Action } from './edit';
import { canRedo, canUndo, commit, createHistory, redo as hRedo, undo as hUndo, type History } from './history';
import { newId, newRiff, type Riff } from './riff';

export const history = signal<History>(createHistory(newRiff()));
export const riff = computed<Riff>(() => history.value.present);
export const selection = signal<Set<string>>(new Set());
export const undoable = computed(() => canUndo(history.value));
export const redoable = computed(() => canRedo(history.value));

const listeners = new Set<(r: Riff) => void>();
/** Subscribe to riff changes (dispatch, undo, redo, load). Returns an unsubscribe function. */
export function onChange(cb: (r: Riff) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const notify = () => listeners.forEach((cb) => cb(riff.peek()));

function coalesceKey(a: Action): string | undefined {
  switch (a.type) {
    case 'nudge':
      return `nudge:${a.ids.join(',')}`;
    case 'bump':
    case 'move':
    case 'resize':
      return `${a.type}:${a.id}`;
    default:
      return undefined;
  }
}

function pruneSelection(r: Riff) {
  const ids = new Set(r.notes.map((n) => n.id));
  const cur = selection.peek();
  const next = new Set([...cur].filter((id) => ids.has(id)));
  if (next.size !== cur.size) selection.value = next;
}

export function dispatch(action: Action, opts: { coalesceKey?: string; now?: number } = {}): void {
  const act = action.type === 'add' && !action.id ? { ...action, id: newId() } : action;
  const cur = history.peek();
  const next = reduce(cur.present, act);
  const key = opts.coalesceKey ?? coalesceKey(act);
  const now = opts.now ?? Date.now();
  history.value = commit(cur, { ...next, updatedAt: now }, key ? { coalesceKey: key, now } : { now });
  if (act.type === 'add' && act.id) selection.value = new Set([act.id]);
  pruneSelection(riff.peek());
  notify();
}

export function undo(): void {
  history.value = hUndo(history.peek());
  pruneSelection(riff.peek());
  notify();
}

export function redo(): void {
  history.value = hRedo(history.peek());
  pruneSelection(riff.peek());
  notify();
}

/** Replaces the current riff and resets undo history and selection. */
export function loadRiff(r: Riff): void {
  history.value = createHistory(r);
  selection.value = new Set();
  notify();
}

if (import.meta.env.MODE === 'test' && typeof window !== 'undefined') {
  (window as unknown as { __riff?: () => Riff }).__riff = () => riff.value;
}
