import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetForTests, getMeta, getRiff, listRiffs, putRiff } from '../../src/model/db';
import { bootLibrary, flushAutosave, removeRiff, startAutosave, summaries } from '../../src/model/library';
import { newRiff } from '../../src/model/riff';
import { dispatch, loadRiff, riff } from '../../src/model/store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stop: () => void = () => {};

beforeEach(async () => {
  await _resetForTests();
  loadRiff(newRiff({ id: 'blank' }));
});
afterEach(() => stop());

describe('library', () => {
  it('boots an empty DB with the saved demo riff', async () => {
    await bootLibrary();
    expect(riff.value.id).toBe('demo');
    expect((await listRiffs()).map((s) => s.id)).toEqual(['demo']);
    expect(await getMeta('lastOpened')).toBe('demo');
  });

  it('restores lastOpened on boot', async () => {
    await putRiff(newRiff({ id: 'a', name: 'A', updatedAt: 100 }));
    await putRiff(newRiff({ id: 'b', name: 'B', updatedAt: 200 }));
    const { setMeta } = await import('../../src/model/db');
    await setMeta('lastOpened', 'a');
    await bootLibrary();
    expect(riff.value.id).toBe('a');
  });

  it('opens the most recent when lastOpened is missing', async () => {
    await putRiff(newRiff({ id: 'a', updatedAt: 100 }));
    await putRiff(newRiff({ id: 'b', updatedAt: 200 }));
    await bootLibrary();
    expect(riff.value.id).toBe('b');
  });

  it('autosaves after the debounce', async () => {
    await bootLibrary();
    stop = startAutosave();
    dispatch({ type: 'rename', name: 'Renamed' });
    await sleep(100);
    expect((await getRiff('demo'))?.name).not.toBe('Renamed');
    await sleep(600);
    await flushAutosave();
    expect((await getRiff('demo'))?.name).toBe('Renamed');
  });

  it('removing the current riff opens another', async () => {
    await putRiff(newRiff({ id: 'a', updatedAt: 100 }));
    await putRiff(newRiff({ id: 'b', updatedAt: 200 }));
    await bootLibrary();
    stop = startAutosave();
    expect(riff.value.id).toBe('b');
    await removeRiff('b');
    expect(riff.value.id).toBe('a');
    expect((await listRiffs()).map((s) => s.id)).toEqual(['a']);
    expect(summaries.value.map((s) => s.id)).toEqual(['a']);
    await removeRiff('a');
    expect(riff.value.id).not.toBe('a');
    expect(await listRiffs()).toHaveLength(1);
  });
});
