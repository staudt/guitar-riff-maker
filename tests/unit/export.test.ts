import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJson, importJson, shareTab, tabText } from '../../src/model/export';
import { newRiff, type Riff } from '../../src/model/riff';

const note = (id: string, step: number, midi: number, length = 2) => ({ id, step, length, midi, velocity: 100 });

/** A small fixed A-minor phrase on the standard tuning. */
const phrase: Riff = newRiff({
  id: 'fixed',
  name: 'Riff',
  createdAt: 0,
  updatedAt: 0,
  bpm: 96,
  bars: 1,
  key: { tonic: 9, scale: 'minor' },
  notes: [note('n0', 0, 45), note('n1', 2, 48), note('n2', 4, 50), note('n3', 6, 52), note('n4', 8, 55), note('n5', 12, 57)],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tabText', () => {
  it('renders the header and tab for a fixed riff', () => {
    expect(tabText(phrase)).toMatchInlineSnapshot(`
      "Riff — A minor — 96 bpm — Standard
      e|--------------------------------|
      B|--------------------------------|
      G|----------------0-------2-------|
      D|--------0---2-------------------|
      A|0---3---------------------------|
      E|--------------------------------|"
    `);
  });

  it('adds a power-chord line when power is on', () => {
    const text = tabText({ ...phrase, power: 'r5' });
    expect(text.split('\n')[1]).toBe('Power chords (5)');
  });
});

describe('json', () => {
  it('round-trips through import with a new id and equal notes', () => {
    const back = importJson(exportJson(phrase));
    expect(back.id).not.toBe(phrase.id);
    expect(back.notes).toEqual(phrase.notes);
    expect({ ...back, id: phrase.id }).toEqual(phrase);
  });

  it('rejects invalid JSON and invalid riffs', () => {
    expect(() => importJson('{not json')).toThrow(/invalid JSON/);
    expect(() => importJson(JSON.stringify({ v: 1, name: 'x' }))).toThrow();
  });
});

describe('shareTab', () => {
  it('uses navigator.share when available', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share });
    expect(await shareTab(phrase)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Riff', text: tabText(phrase) });
  });

  it('falls back to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareTab(phrase)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(tabText(phrase));
  });

  it('propagates a cancelled share', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    vi.stubGlobal('navigator', { share: vi.fn(async () => Promise.reject(abort)) });
    await expect(shareTab(phrase)).rejects.toBe(abort);
  });
});
