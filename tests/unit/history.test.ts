import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, createHistory, redo, undo } from '../../src/model/history';
import { newRiff } from '../../src/model/riff';

const v = (n: number) => newRiff({ id: 'r', bpm: n });

describe('history', () => {
  it('undo/redo', () => {
    let h = createHistory(v(1));
    expect(canUndo(h)).toBe(false);
    h = commit(h, v(2));
    h = commit(h, v(3));
    h = undo(h);
    expect(h.present.bpm).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present.bpm).toBe(3);
    h = undo(undo(h));
    h = commit(h, v(9));
    expect(canRedo(h)).toBe(false);
    expect(undo(undo(h)).present.bpm).toBe(1);
  });
  it('coalesces within 800ms only', () => {
    let h = createHistory(v(1));
    h = commit(h, v(2), { coalesceKey: 'k', now: 0 });
    h = commit(h, v(3), { coalesceKey: 'k', now: 500 });
    expect(h.past).toHaveLength(1);
    h = commit(h, v(4), { coalesceKey: 'k', now: 1400 });
    expect(h.past).toHaveLength(2);
    h = commit(h, v(5), { coalesceKey: 'other', now: 1500 });
    expect(h.past).toHaveLength(3);
    expect(undo(undo(h)).present.bpm).toBe(3);
  });
  it('caps past at 100', () => {
    let h = createHistory(v(0));
    for (let i = 1; i <= 150; i++) h = commit(h, v(i));
    expect(h.past).toHaveLength(100);
    for (let i = 0; i < 200; i++) h = undo(h);
    expect(h.present.bpm).toBe(50);
  });
});
