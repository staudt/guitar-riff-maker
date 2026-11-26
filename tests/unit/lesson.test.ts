import { describe, expect, it } from 'vitest';
import { activeAt, nextAfter, nextIndex, prevIndex } from '../../src/model/lesson';

const notes = [
  { step: 0, length: 2 },
  { step: 4, length: 4 },
  { step: 16, length: 1 },
  { step: 20, length: 2 },
];

describe('lesson helpers', () => {
  it('nextIndex wraps over the whole riff', () => {
    expect(nextIndex(notes, -1)).toBe(0);
    expect(nextIndex(notes, 1)).toBe(2);
    expect(nextIndex(notes, 3)).toBe(0);
    expect(nextIndex([], 0)).toBe(-1);
  });
  it('prevIndex wraps', () => {
    expect(prevIndex(notes, 2)).toBe(1);
    expect(prevIndex(notes, 0)).toBe(3);
    expect(prevIndex(notes, -1)).toBe(3);
  });
  it('respects the loop range', () => {
    const loop = { start: 16, end: 32 };
    expect(nextIndex(notes, -1, loop)).toBe(2);
    expect(nextIndex(notes, 3, loop)).toBe(2);
    expect(nextAfter(notes, 3, loop)).toBe(2);
    expect(prevIndex(notes, 2, loop)).toBe(3);
    expect(nextIndex(notes, 0, { start: 8, end: 12 })).toBe(-1);
  });
  it('end <= start means everything', () => {
    expect(nextIndex(notes, 3, { start: 8, end: 0 })).toBe(0);
  });
  it('activeAt', () => {
    expect(activeAt(notes, 1)).toBe(0);
    expect(activeAt(notes, 2)).toBe(-1);
    expect(activeAt(notes, 7)).toBe(1);
    expect(activeAt(notes, 20)).toBe(3);
  });
});
