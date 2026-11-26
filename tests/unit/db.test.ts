import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTests, deleteRiff, duplicateRiff, getMeta, getRiff, listRiffs, putRiff, setMeta } from '../../src/model/db';
import { newRiff, type Riff } from '../../src/model/riff';

const note = (id: string, step: number, midi: number) => ({ id, step, length: 2, midi, velocity: 100 });

function make(id: string, name: string, updatedAt: number, notes = [note('a', 0, 40), note('b', 4, 45)]): Riff {
  return newRiff({ id, name, createdAt: 1, updatedAt, bars: 2, notes });
}

beforeEach(async () => {
  await _resetForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('riff store', () => {
  it('round-trips a riff through put and get', async () => {
    const r = make('r1', 'Intro', 10);
    await putRiff(r);
    const back = await getRiff('r1');
    expect(back).toEqual(r);
  });

  it('returns null for a missing id', async () => {
    expect(await getRiff('nope')).toBeNull();
  });

  it('rejects invalid riffs on write', async () => {
    await expect(putRiff({ ...make('bad', 'Bad', 1), bpm: 0 })).rejects.toThrow();
  });

  it('lists summaries sorted by updatedAt, newest first', async () => {
    await putRiff(make('old', 'Old', 100, [note('a', 0, 40)]));
    await putRiff(make('new', 'New', 300, [note('a', 0, 40), note('b', 2, 42), note('c', 4, 43)]));
    await putRiff(make('mid', 'Mid', 200));
    const list = await listRiffs();
    expect(list.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
    expect(list[0]).toEqual({
      id: 'new',
      name: 'New',
      updatedAt: 300,
      key: { tonic: 9, scale: 'minor' },
      bpm: 96,
      bars: 2,
      noteCount: 3,
    });
  });

  it('deletes a riff', async () => {
    await putRiff(make('gone', 'Gone', 1));
    await deleteRiff('gone');
    expect(await getRiff('gone')).toBeNull();
    expect(await listRiffs()).toEqual([]);
  });

  it('duplicates under a new id with a new name and timestamps, leaving the original alone', async () => {
    const src = make('src', 'Verse', 5);
    await putRiff(src);
    const before = Date.now();
    const copy = await duplicateRiff('src');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('src');
    expect(copy!.name).toBe('Verse (copy)');
    expect(copy!.createdAt).toBeGreaterThanOrEqual(before);
    expect(copy!.updatedAt).toBe(copy!.createdAt);
    expect(copy!.notes).toEqual(src.notes);
    expect(await getRiff('src')).toEqual(src);
    expect((await getRiff(copy!.id))?.name).toBe('Verse (copy)');
    expect(await listRiffs()).toHaveLength(2);
  });

  it('duplicate of a missing riff is null', async () => {
    expect(await duplicateRiff('missing')).toBeNull();
  });

  it('skips invalid stored records: list omits them, get returns null with a warning', async () => {
    await putRiff(make('good', 'Good', 1));
    // Inject a junk record straight into the raw database, bypassing putRiff's validation.
    await listRiffs();
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('riffmaker', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction('riffs', 'readwrite');
      tx.objectStore('riffs').put({ id: 'junk', name: 42, notes: 'nope' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    raw.close();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await listRiffs()).map((s) => s.id)).toEqual(['good']);
    expect(await getRiff('junk')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('meta: missing key is undefined, set then get, overwrite', async () => {
    expect(await getMeta<string>('lastOpened')).toBeUndefined();
    await setMeta('lastOpened', 'r1');
    expect(await getMeta<string>('lastOpened')).toBe('r1');
    await setMeta('lastOpened', 'r2');
    expect(await getMeta<string>('lastOpened')).toBe('r2');
  });
});
