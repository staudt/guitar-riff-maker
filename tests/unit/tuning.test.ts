import { describe, expect, it } from 'vitest';
import { DROP_D, HALF_DOWN, rangeOf, STANDARD, stringName, TUNINGS } from '../../src/music/tuning';

describe('tuning', () => {
  it('defines the tunings', () => {
    expect(STANDARD.strings).toEqual([40, 45, 50, 55, 59, 64]);
    expect(DROP_D.strings).toEqual([38, 45, 50, 55, 59, 64]);
    expect(HALF_DOWN.strings).toEqual([39, 44, 49, 54, 58, 63]);
    expect(TUNINGS).toContain(STANDARD);
  });
  it('names strings', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => stringName(STANDARD, i))).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
    expect(stringName(DROP_D, 0)).toBe('D');
    expect(stringName(DROP_D, 5)).toBe('E');
    expect(stringName(HALF_DOWN, 5)).toBe('eb');
  });
  it('computes range', () => {
    expect(rangeOf(STANDARD, 22)).toEqual([40, 86]);
  });
});
