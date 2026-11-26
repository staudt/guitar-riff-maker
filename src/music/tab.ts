// Column model shared by TabView and the text export.
import type { Pos } from './types';

export type TabColumn = {
  step: number;
  /** One entry per string, index 0 = HIGHEST string (display order). null = nothing here (rest or hold). */
  cells: (string | null)[];
  /** Index of the note starting in this column, else null. */
  noteIndex: number | null;
  /** True when this column starts a bar (16 steps). */
  barline: boolean;
};

export type TabInput = {
  notes: { step: number; length: number }[];
  /** Per note, 1..3 positions (several for power chords). Fret -1 = unplayable. */
  pos: Pos[][];
  strings: number;
  totalSteps: number;
  grid: 8 | 16;
};

const STEPS_PER_BAR = 16;

/** One column per grid unit; an off-grid onset gets its own extra column. Hold continuation cells are null.
 *  fret -1 on a valid string renders 'x'; positions with string -1 (UNPLAYABLE marker) draw nothing. */
export function layoutTab(input: TabInput): TabColumn[] {
  const unit = input.grid === 8 ? 2 : 1;
  const onsets = new Map<number, number>();
  input.notes.forEach((n, i) => {
    if (n.step >= 0 && n.step < input.totalSteps && !onsets.has(n.step)) onsets.set(n.step, i);
  });
  const steps = new Set<number>();
  for (let s = 0; s < input.totalSteps; s += unit) steps.add(s);
  for (const s of onsets.keys()) steps.add(s);
  return [...steps]
    .sort((a, b) => a - b)
    .map((step) => {
      const cells: (string | null)[] = new Array(input.strings).fill(null);
      const ni = onsets.get(step);
      if (ni !== undefined) {
        for (const p of input.pos[ni] ?? []) {
          if (p.string < 0 || p.string >= input.strings) continue;
          cells[input.strings - 1 - p.string] = p.fret < 0 ? 'x' : String(p.fret);
        }
      }
      return { step, cells, noteIndex: ni ?? null, barline: step % STEPS_PER_BAR === 0 };
    });
}

/** Silence (ms) before a note that earns 1, 2, 3 spacer columns in sequence layout. */
const SPACER_MS = [150, 400, 900] as const;

/**
 * Free-timing layout: one column per note, plus 0-3 empty spacer columns before a note depending on the
 * gap since the previous note ended (step = 10 ms ticks). Only the first column carries a barline.
 */
export function layoutTabSequence(input: TabInput, tickMs = 10): TabColumn[] {
  const out: TabColumn[] = [];
  let prevEnd = 0;
  const blank = () => new Array<string | null>(input.strings).fill(null);
  input.notes.forEach((n, i) => {
    if (n.step < 0 || n.step >= input.totalSteps) return;
    const gapMs = (n.step - prevEnd) * tickMs;
    const spacers = SPACER_MS.filter((t) => gapMs >= t).length;
    for (let k = 0; k < spacers; k++) out.push({ step: prevEnd, cells: blank(), noteIndex: null, barline: false });
    const cells = blank();
    for (const p of input.pos[i] ?? []) {
      if (p.string < 0 || p.string >= input.strings) continue;
      cells[input.strings - 1 - p.string] = p.fret < 0 ? 'x' : String(p.fret);
    }
    out.push({ step: n.step, cells, noteIndex: i, barline: false });
    prevEnd = n.step + n.length;
  });
  if (out.length === 0) out.push({ step: 0, cells: blank(), noteIndex: null, barline: true });
  else out[0] = { ...out[0]!, barline: true };
  return out;
}

/** ASCII tab: header line then one line per string (highest first), wrapped every `barsPerLine` bars. */
export function renderTabText(header: string, cols: readonly TabColumn[], stringNames: readonly string[], opts?: { barsPerLine?: number; colsPerLine?: number }): string {
  const colsPerLine = opts?.colsPerLine;
  const perLine = colsPerLine ? 1 : (opts?.barsPerLine ?? 2);
  let width = 1;
  for (const c of cols) for (const cell of c.cells) if (cell) width = Math.max(width, cell.length);
  const nStr = stringNames.length;
  const label = stringNames.map((n) => n.padEnd(Math.max(...stringNames.map((s) => s.length))));
  // Split into bars.
  const bars: TabColumn[][] = [];
  for (const c of cols) {
    if (colsPerLine ? (bars[bars.length - 1]?.length ?? colsPerLine) >= colsPerLine : c.barline || bars.length === 0) bars.push([]);
    bars[bars.length - 1]!.push(c);
  }
  const systems: string[] = [];
  for (let b = 0; b < bars.length; b += perLine) {
    const lines: string[] = [];
    for (let row = 0; row < nStr; row++) {
      let line = (label[nStr - 1 - row] ?? '') + '|';
      for (const bar of bars.slice(b, b + perLine)) {
        for (const c of bar) line += (c.cells[row] ?? '').padEnd(width, '-') + '-';
        line += '|';
      }
      lines.push(line);
    }
    systems.push(lines.join('\n'));
  }
  return [header, ...systems.flatMap((s, i) => (i === 0 ? [s] : ['', s]))].join('\n');
}
