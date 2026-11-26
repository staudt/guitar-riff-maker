// Riff library and autosave: glues the editor store to IndexedDB. If storage is unavailable
// (private mode, quota), everything keeps working in memory and `storageError` is set.
import { signal } from '@preact/signals';
import { screen } from '../app/nav';
import { deleteRiff, duplicateRiff, getMeta, getRiff, listRiffs, putRiff, setMeta, type RiffSummary } from './db';
import { demoRiff } from './demo';
import { importJson } from './export';
import { newRiff, type Riff } from './riff';
import { dispatch, loadRiff, onChange, riff } from './store';

export const summaries = signal<RiffSummary[]>([]);
/** Message when IndexedDB could not be used; null when storage is fine. */
export const storageError = signal<string | null>(null);

const SAVE_DELAY_MS = 500;

function fail(err: unknown): void {
  storageError.value = err instanceof Error ? err.message || 'Storage unavailable' : 'Storage unavailable';
}

/** Runs a storage call; on failure records storageError and returns the fallback. */
async function safe<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch (err) {
    fail(err);
    return fallback;
  }
}

export async function refreshLibrary(): Promise<void> {
  summaries.value = await safe(listRiffs, summaries.peek());
}

// ---- autosave ----------------------------------------------------------------------------------
let pending: Riff | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

async function save(r: Riff): Promise<void> {
  try {
    await putRiff(r);
    await setMeta('lastOpened', r.id);
    storageError.value = null;
  } catch (err) {
    fail(err);
  }
}

/** Writes any pending riff now. Resolves when all queued writes are done. */
export function flushAutosave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) {
    const r = pending;
    pending = null;
    chain = chain.then(() => save(r));
  }
  return chain;
}

function cancelPending(id?: string): void {
  if (id && pending && pending.id !== id) return;
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

let started = false;

/** Subscribes to store changes: debounced save, flushed when the page is hidden. Idempotent. Returns stop. */
export function startAutosave(): () => void {
  if (started) return () => {};
  started = true;
  const off = onChange((r) => {
    pending = r;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flushAutosave();
    }, SAVE_DELAY_MS);
  });
  const onVis = () => {
    if (document.visibilityState === 'hidden') void flushAutosave();
  };
  const onHide = () => void flushAutosave();
  const hasDoc = typeof document !== 'undefined';
  if (hasDoc) {
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
  }
  return () => {
    started = false;
    off();
    if (hasDoc) {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    }
    cancelPending();
  };
}

// ---- library -----------------------------------------------------------------------------------
/** Loads the last opened riff (or the most recent, or the demo on first run) into the editor. */
export async function bootLibrary(): Promise<void> {
  try {
    const list = await safe(listRiffs, [] as RiffSummary[]);
    summaries.value = list;
    const lastId = await safe(() => getMeta<string>('lastOpened'), undefined);
    let r: Riff | null = lastId ? await safe(() => getRiff(lastId), null) : null;
    const first = list[0];
    if (!r && first) r = await safe(() => getRiff(first.id), null);
    if (r) {
      loadRiff(r);
      return;
    }
    if (list.length === 0) {
      const demo = demoRiff();
      loadRiff(demo);
      await save(demo);
      await refreshLibrary();
    }
  } catch (err) {
    fail(err);
  }
}

export async function openRiff(id: string): Promise<boolean> {
  await flushAutosave();
  const r = await safe(() => getRiff(id), null);
  if (!r) return false;
  loadRiff(r);
  await safe(() => setMeta('lastOpened', id), undefined);
  screen.value = 'riff';
  return true;
}

export async function newBlankRiff(): Promise<void> {
  await flushAutosave();
  const r = newRiff({ name: 'New riff' });
  loadRiff(r);
  cancelPending(); // loadRiff queued it for autosave; save now instead
  await save(r);
  await refreshLibrary();
  screen.value = 'riff';
}

export async function removeRiff(id: string): Promise<void> {
  const wasCurrent = riff.peek().id === id;
  cancelPending(id);
  await flushAutosave();
  await safe(() => deleteRiff(id), undefined);
  await refreshLibrary();
  if (!wasCurrent) return;
  cancelPending();
  const next = summaries.peek().find((s) => s.id !== id);
  if (next) {
    const r = await safe(() => getRiff(next.id), null);
    if (r) {
      loadRiff(r);
      cancelPending();
      await safe(() => setMeta('lastOpened', r.id), undefined);
      return;
    }
  }
  const blank = newRiff({ name: 'New riff' });
  loadRiff(blank);
  cancelPending();
  await save(blank);
  await refreshLibrary();
}

export async function duplicate(id: string): Promise<void> {
  await flushAutosave();
  await safe(() => duplicateRiff(id), null);
  await refreshLibrary();
}

export async function renameRiff(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  if (riff.peek().id === id) {
    dispatch({ type: 'rename', name: clean });
    await flushAutosave();
  } else {
    await flushAutosave();
    const r = await safe(() => getRiff(id), null);
    if (r) await safe(() => putRiff({ ...r, name: clean, updatedAt: Date.now() }), undefined);
  }
  await refreshLibrary();
}

/** Imports an exported riff JSON file under a fresh id and opens it. Throws a readable error on bad input. */
export async function importFromFile(file: File): Promise<void> {
  const r = importJson(await file.text());
  await flushAutosave();
  await safe(() => putRiff(r), undefined);
  await refreshLibrary();
  await openRiff(r.id);
  if (riff.peek().id !== r.id) {
    // Storage failed: still show the imported riff in memory.
    loadRiff(r);
    screen.value = 'riff';
  }
}
