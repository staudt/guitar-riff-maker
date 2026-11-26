// Tab of the riff: six lines (high e on top), mono fret numbers, bar lines, beat ticks. Never mirrored.
import './views.css';
import { selection, riff } from '../model/store';
import { fingering } from '../model/fingering';
import { layoutTab } from '../music/tab';
import { stringName } from '../music/tuning';
import { totalSteps } from '../model/riff';

const COL_W = 22;
const COL_W_WIDE = 30;
const ROW_H = 18;
const TOP = 14;
const PAD_L = 8;
const PAD_R = 14;
const HEIGHT = TOP + ROW_H * 5 + 30;
const NAMES_W = 22;

let stepX: (step: number) => number = (s) => PAD_L + s * 12;

/** Current x (px, within the scrolling tab surface) of a step; centre of the column. Updated on every render. */
export function getTabStepX(): (step: number) => number {
  return stepX;
}

export interface TabViewProps {
  mode?: 'edit' | 'lesson';
  onSelectNote?: (id: string) => void;
}

export function TabView({ mode = 'edit', onSelectNote }: TabViewProps) {
  const r = riff.value;
  const fg = fingering.value;
  const sel = selection.value;
  const n = r.tuning.strings.length;
  const total = totalSteps(r);
  const cols = layoutTab({ notes: r.notes, pos: fg.pos, strings: n, totalSteps: total, grid: r.grid });

  // Column geometry.
  const widths = cols.map((c) => (c.cells.some((s) => s !== null && s.length > 1) ? COL_W_WIDE : COL_W));
  const starts: number[] = [];
  let x = PAD_L;
  widths.forEach((w, i) => {
    starts[i] = x;
    x += w;
  });
  const endX = x;
  const width = endX + PAD_R;
  const centers = cols.map((_, i) => starts[i]! + widths[i]! / 2);
  const unitW = r.grid === 8 ? COL_W / 2 : COL_W;
  stepX = (step: number) => {
    if (!cols.length) return PAD_L;
    let i = 0;
    while (i + 1 < cols.length && cols[i + 1]!.step <= step) i++;
    const c = cols[i]!;
    const next = cols[i + 1];
    const cx = centers[i]!;
    if (next) return cx + ((step - c.step) / (next.step - c.step)) * (centers[i + 1]! - cx);
    return cx + (step - c.step) * unitW;
  };

  const lineY = (row: number) => TOP + row * ROW_H;
  const tickY = lineY(n - 1) + 12;

  return (
    <div class="tab" data-mode={mode} data-testid="tab-view">
      <svg class="tab__names" width={NAMES_W} height={HEIGHT} aria-hidden="true">
        {Array.from({ length: n }, (_, row) => (
          <text key={row} class="tab__name" x={NAMES_W - 6} y={lineY(row) + 4} text-anchor="end">
            {stringName(r.tuning, n - 1 - row)}
          </text>
        ))}
      </svg>
      <div class="tab__scroll" data-testid="tab-scroll">
        <div class="tab__surface" style={{ width: `${width}px`, height: `${HEIGHT}px` }}>
          <svg class="tab__svg" width={width} height={HEIGHT} role="img" aria-label="Guitar tab">
            {Array.from({ length: n }, (_, row) => (
              <line key={row} class="tab__line" x1={PAD_L} x2={endX} y1={lineY(row)} y2={lineY(row)} />
            ))}
            {cols.map((c, i) =>
              c.barline ? (
                <line key={`b${i}`} class="tab__bar" x1={starts[i]} x2={starts[i]} y1={lineY(0)} y2={lineY(n - 1)} />
              ) : null,
            )}
            <line class="tab__bar" x1={endX} x2={endX} y1={lineY(0)} y2={lineY(n - 1)} />
            {cols.map((c, i) =>
              c.step % 4 === 0 ? (
                <line key={`t${i}`} class={c.step % 16 === 0 ? 'tab__tick tab__tick--bar' : 'tab__tick'} x1={centers[i]} x2={centers[i]} y1={tickY} y2={tickY + (c.step % 16 === 0 ? 8 : 5)} />
              ) : null,
            )}
            {cols.map((c, i) => {
              if (c.noteIndex === null) return null;
              const note = r.notes[c.noteIndex];
              if (!note) return null;
              const first = fg.pos[c.noteIndex]?.[0];
              return (
                <g
                  key={note.id}
                  class="tab__note"
                  data-testid="tab-note"
                  data-note-index={c.noteIndex}
                  data-note-id={note.id}
                  data-fret={first ? first.fret : -1}
                  data-selected={sel.has(note.id) ? '' : undefined}
                  onClick={() => {
                    selection.value = new Set([note.id]);
                    onSelectNote?.(note.id);
                  }}
                >
                  <rect class="tab__hit" x={starts[i]} y={0} width={widths[i]} height={HEIGHT} />
                  {c.cells.map((cell, row) =>
                    cell === null ? null : (
                      <g key={row}>
                        <rect class="tab__cellbg" x={centers[i]! - (cell.length * 4 + 2)} y={lineY(row) - 8} width={cell.length * 8 + 4} height={16} rx={3} />
                        <text class="tab__num" x={centers[i]} y={lineY(row) + 4} text-anchor="middle">
                          {cell}
                        </text>
                      </g>
                    ),
                  )}
                </g>
              );
            })}
          </svg>
          <div class="tab__playhead" data-tab-playhead style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  );
}
