import { describe, expect, it } from 'vitest';
import { layoutTab, renderTabText } from '../../src/music/tab';
import { STANDARD, stringName } from '../../src/music/tuning';

const names = STANDARD.strings.map((_, i) => stringName(STANDARD, i));
const P = (string: number, fret: number) => ({ string, fret });

describe('layoutTab', () => {
  it('one column per 16th, holds are null', () => {
    const cols = layoutTab({ notes: [{ step: 0, length: 4 }], pos: [[P(0, 5)]], strings: 6, totalSteps: 16, grid: 16 });
    expect(cols).toHaveLength(16);
    expect(cols[0]!.cells[5]).toBe('5');
    expect(cols[0]!.noteIndex).toBe(0);
    expect(cols[0]!.barline).toBe(true);
    expect(cols[1]!.cells.every((c) => c === null)).toBe(true);
    expect(cols[1]!.noteIndex).toBeNull();
    expect(cols[1]!.barline).toBe(false);
  });
  it('grid 8 halves columns and keeps off-grid onsets', () => {
    const cols = layoutTab({ notes: [{ step: 0, length: 1 }, { step: 3, length: 1 }], pos: [[P(0, 1)], [P(1, 2)]], strings: 6, totalSteps: 16, grid: 8 });
    expect(cols).toHaveLength(9);
    expect(cols.map((c) => c.step).slice(0, 4)).toEqual([0, 2, 3, 4]);
  });
  it('stacks power chords and marks unplayable', () => {
    const cols = layoutTab({ notes: [{ step: 0, length: 1 }, { step: 1, length: 1 }], pos: [[P(0, 3), P(1, 5)], [P(-1, -1)]], strings: 6, totalSteps: 16, grid: 16 });
    expect(cols[0]!.cells).toEqual([null, null, null, null, '5', '3']);
    expect(cols[1]!.cells.filter(Boolean)).toEqual([]);
  });
});

describe('renderTabText', () => {
  it('golden one-bar riff', () => {
    const notes = [0, 4, 8, 12].map((step) => ({ step, length: 4 }));
    const cols = layoutTab({ notes, pos: [[P(0, 5)], [P(1, 7)], [P(2, 5)], [P(1, 5)]], strings: 6, totalSteps: 16, grid: 16 });
    const bar = (cells: string[]) => cells.join('');
    const row = (at: Record<number, string>) => bar(Array.from({ length: 16 }, (_, i) => (at[i] ?? '-').padEnd(1, '-') + '-'));
    expect(renderTabText('Riff', cols, names)).toBe(
      [
        'Riff',
        `e|${row({})}|`,
        `B|${row({})}|`,
        `G|${row({})}|`,
        `D|${row({ 8: '5' })}|`,
        `A|${row({ 4: '7', 12: '5' })}|`,
        `E|${row({ 0: '5' })}|`,
      ].join('\n'),
    );
    expect(renderTabText('Riff', cols, names).split('\n')[6]).toBe('E|5-------------------------------|');
  });
  it('widens columns for two-digit frets', () => {
    const cols = layoutTab({ notes: [{ step: 0, length: 1 }, { step: 1, length: 1 }], pos: [[P(5, 12)], [P(5, 3)]], strings: 6, totalSteps: 16, grid: 16 });
    const lines = renderTabText('x', cols, names).split('\n');
    expect(lines[1]).toBe('e|12-3--' + '---'.repeat(14) + '|');
  });
  it('wraps every two bars and renders x and stacks', () => {
    const cols = layoutTab({ notes: [{ step: 0, length: 1 }, { step: 16, length: 1 }], pos: [[P(0, 3), P(1, 5)], [P(2, -1)]], strings: 6, totalSteps: 48, grid: 8 });
    const out = renderTabText('Pow', cols, names, { barsPerLine: 2 });
    const blocks = out.split('\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.split('\n')).toHaveLength(7);
    expect(blocks[0]).toContain('A|5-');
    expect(blocks[0]).toContain('E|3-');
    expect(blocks[0]).toContain('x');
  });
});
