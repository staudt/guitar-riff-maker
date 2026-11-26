import { expect } from 'vitest';
import { totalSteps, type Riff } from '../../src/model/riff';

export function assertNormalized(r: Riff) {
  const total = totalSteps(r);
  let prevEnd = 0;
  r.notes.forEach((n, i) => {
    expect(Number.isInteger(n.step) && Number.isInteger(n.length)).toBe(true);
    expect(n.step).toBeGreaterThanOrEqual(0);
    expect(n.length).toBeGreaterThanOrEqual(1);
    expect(n.step + n.length).toBeLessThanOrEqual(total);
    expect(n.midi).toBeGreaterThanOrEqual(0);
    expect(n.midi).toBeLessThanOrEqual(127);
    expect(n.velocity).toBeGreaterThanOrEqual(1);
    expect(n.velocity).toBeLessThanOrEqual(127);
    if (i > 0) expect(n.step).toBeGreaterThanOrEqual(prevEnd);
    prevEnd = n.step + n.length;
  });
}

