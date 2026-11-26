// IndexedDB persistence for riffs and small app metadata. Hand-written wrapper; no runtime dependency.
// Riffs are validated with parseRiff on the way out (bad rows are skipped) and on the way in (bad input throws).
import { newId, parseRiff, type Riff } from './riff';

const DB_NAME = 'riffmaker';
const DB_VERSION = 1;
const RIFFS = 'riffs';
/** Out-of-line key/value records (e.g. 'lastOpened'). */
const META = 'meta';

export type RiffSummary = {
  id: string;
  name: string;
  updatedAt: number;
  key: Riff['key'];
  bpm: number;
  bars: Riff['bars'];
  noteCount: number;
};

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(RIFFS)) d.createObjectStore(RIFFS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      req.onsuccess = () => {
        const d = req.result;
        // Another connection is upgrading or deleting the database: let go so it can proceed, reopen on next use.
        d.onversionchange = () => {
          d.close();
          dbp = null;
        };
        resolve(d);
      };
      req.onerror = () => {
        dbp = null;
        reject(req.error);
      };
    });
  }
  return dbp;
}

/** One request in its own transaction; resolves once the transaction commits. */
function run<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = f(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

/** Parses a stored record; invalid records are reported and yield null rather than throwing. */
function decode(raw: unknown, where: string): Riff | null {
  try {
    return parseRiff(raw);
  } catch (err) {
    console.warn(`riffmaker: skipping invalid riff record ${where}`, err);
    return null;
  }
}

/** All saved riffs as summaries, most recently updated first. Invalid records are skipped. */
export async function listRiffs(): Promise<RiffSummary[]> {
  const raws = await run<unknown[]>(RIFFS, 'readonly', (s) => s.getAll());
  const out: RiffSummary[] = [];
  for (const raw of raws) {
    const r = decode(raw, 'in list');
    if (!r) continue;
    out.push({
      id: r.id,
      name: r.name,
      updatedAt: r.updatedAt,
      key: r.key,
      bpm: r.bpm,
      bars: r.bars,
      noteCount: r.notes.length,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The riff with this id, or null when missing or invalid. */
export async function getRiff(id: string): Promise<Riff | null> {
  const raw = await run<unknown>(RIFFS, 'readonly', (s) => s.get(id));
  if (raw === undefined) return null;
  return decode(raw, id);
}

/** Validates (throws on junk) and stores the riff under its id. Does not touch updatedAt; the caller sets it. */
export async function putRiff(riff: Riff): Promise<void> {
  const clean = parseRiff(riff);
  await run(RIFFS, 'readwrite', (s) => s.put(clean));
}

export async function deleteRiff(id: string): Promise<void> {
  await run(RIFFS, 'readwrite', (s) => s.delete(id));
}

/** Stores a copy under a new id, named "<name> (copy)", with fresh timestamps. Null when the source is missing. */
export async function duplicateRiff(id: string): Promise<Riff | null> {
  const src = await getRiff(id);
  if (!src) return null;
  const now = Date.now();
  const copy: Riff = { ...src, id: newId(), name: `${src.name} (copy)`, createdAt: now, updatedAt: now };
  await putRiff(copy);
  return copy;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>(META, 'readonly', (s) => s.get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await run(META, 'readwrite', (s) => s.put(value, key));
}

/**
 * Test hook: closes the connection, then deletes the whole database so the next call starts empty.
 * Not for app code.
 */
export async function _resetForTests(): Promise<void> {
  if (dbp) {
    try {
      (await dbp).close();
    } catch {
      // Opening failed earlier; nothing to close.
    }
  }
  dbp = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
