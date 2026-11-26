// SVG fretboard: a 7-fret window that follows the hand, plus a mini full-neck map.
// Left-handed mode mirrors the board drawing only; dots' labels and text are drawn unmirrored.
import './views.css';
import { riff, selection } from '../model/store';
import { fingering } from '../model/fingering';
import { lefty, lowStringBottom, showNoteNames } from '../app/settings';
import { pcName } from '../music/theory';
import { stringName } from '../music/tuning';
import type { Pos } from '../music/types';
import {
  BOARD_L,
  BOARD_R,
  INLAYS,
  LABEL_Y,
  NECK_H,
  NECK_W,
  STRING_BOTTOM,
  STRING_TOP,
  fretX,
  mirrorX,
  noteX,
  pointFor,
  stringY,
  windowFor,
  wireLo,
  type FretWindow,
} from './neckGeometry';

let current: { w: FretWindow; count: number; lowBottom: boolean; mirror: boolean } = {
  w: { start: 0, end: 6 },
  count: 6,
  lowBottom: true,
  mirror: false,
};

/** Point (neck svg user units, after mirroring) of a position in the currently rendered window. */
export function neckPoint(pos: Pos): { x: number; y: number } {
  return pointFor(pos, current.w, current.count, current.lowBottom, current.mirror);
}

export interface NeckViewProps {
  mode?: 'edit' | 'lesson';
  ghosts?: Pos[];
  onPickGhost?: (pos: Pos) => void;
}

type Dot = { pos: Pos; indexes: number[] };

let lastStart = 0;

export function NeckView({ mode = 'edit', ghosts, onPickGhost }: NeckViewProps) {
  const r = riff.value;
  const fg = fingering.value;
  const sel = selection.value;
  const mirror = lefty.value;
  const lowBottom = lowStringBottom.value;
  const names = showNoteNames.value;
  const n = r.tuning.strings.length;

  const all: Pos[] = fg.pos.flat().filter((p) => p.fret >= 0 && p.string >= 0);
  const w = windowFor(fg.anchor, all, r.maxFret);
  current = { w, count: n, lowBottom, mirror };
  const dir = w.start >= lastStart ? 1 : -1;
  lastStart = w.start;

  const mx = (x: number) => (mirror ? mirrorX(x) : x);
  const yOf = (s: number) => stringY(s, n, lowBottom);

  // Unique dots.
  const dots = new Map<string, Dot>();
  fg.pos.forEach((ps, i) => {
    for (const p of ps) {
      if (p.fret < 0 || p.string < 0) continue;
      const k = `${p.string}:${p.fret}`;
      const d = dots.get(k);
      if (d) d.indexes.push(i);
      else dots.set(k, { pos: p, indexes: [i] });
    }
  });

  const label = (p: Pos) => (names ? pcName((r.tuning.strings[p.string] ?? 0) + p.fret) : String(p.fret));
  const inWin = (p: Pos) => p.fret >= w.start && p.fret <= w.end || (p.fret === 0 && w.start === 0);
  const wires: number[] = [];
  for (let f = wireLo(w); f <= w.end; f++) wires.push(f);
  const nutAtLeft = w.start <= 1;
  const labelFrets: number[] = [];
  for (let f = Math.max(w.start, 1); f <= w.end; f++) labelFrets.push(f);

  // Mini strip.
  const MINI_W = NECK_W;
  const MINI_H = 16;
  const mini = (f: number) => mx(6 + (f / Math.max(r.maxFret, 1)) * (MINI_W - 12));
  const miniA = mini(w.start - 0.5);
  const miniB = mini(w.end + 0.5);

  const links: preact.JSX.Element[] = [];
  fg.pos.forEach((ps, i) => {
    const s = ps.filter((p) => p.fret >= 0 && p.string >= 0 && inWin(p)).sort((a, b) => a.string - b.string);
    for (let k = 1; k < s.length; k++) {
      const a = s[k - 1]!;
      const b = s[k]!;
      links.push(
        <line key={`l${i}-${k}`} class="neck__link" x1={mx(noteX(a.fret, w))} y1={yOf(a.string)} x2={mx(noteX(b.fret, w))} y2={yOf(b.string)} />,
      );
    }
  });

  return (
    <div class="neck" data-mode={mode} data-lefty={mirror ? '' : undefined} data-testid="neck-view">
      <svg class="neck__svg" viewBox={`0 0 ${NECK_W} ${NECK_H}`} role="img" aria-label="Fretboard">
        <g class="neck__pan" key={w.start} style={{ '--pan': `${dir * 24}px` }}>
          <g data-board transform={mirror ? `translate(${NECK_W},0) scale(-1,1)` : undefined}>
            <rect class="neck__wood" x={BOARD_L - (nutAtLeft ? 0 : 6)} y={STRING_TOP - 10} width={BOARD_R - BOARD_L + (nutAtLeft ? 4 : 10)} height={STRING_BOTTOM - STRING_TOP + 20} rx={4} />
            {INLAYS.filter((f) => f >= w.start && f <= w.end).map((f) => {
              const cx = noteX(f, w);
              const mid = (STRING_TOP + STRING_BOTTOM) / 2;
              return f % 12 === 0 ? (
                <g key={`i${f}`}>
                  <circle class="neck__inlay" cx={cx} cy={mid - 14} r={3.5} />
                  <circle class="neck__inlay" cx={cx} cy={mid + 14} r={3.5} />
                </g>
              ) : (
                <circle key={`i${f}`} class="neck__inlay" cx={cx} cy={mid} r={3.5} />
              );
            })}
            {wires.map((f) => (
              <line key={`w${f}`} class={f === 0 ? 'neck__nut' : 'neck__fret'} x1={fretX(f, w)} x2={fretX(f, w)} y1={STRING_TOP - 10} y2={STRING_BOTTOM + 10} />
            ))}
            {Array.from({ length: n }, (_, s) => (
              <line key={`s${s}`} class="neck__string" x1={BOARD_L - (nutAtLeft ? 0 : 6)} x2={BOARD_R + 4} y1={yOf(s)} y2={yOf(s)} stroke-width={1 + (n - 1 - s) * 0.35} />
            ))}
          </g>
          {labelFrets.map((f) => (
            <text key={`n${f}`} class="neck__fretnum" x={mx(noteX(f, w))} y={LABEL_Y} text-anchor="middle">
              {f}
            </text>
          ))}
          {Array.from({ length: n }, (_, s) => (
            <text key={`sn${s}`} class="neck__sname" x={mx(5)} y={yOf(s) + 3.5} text-anchor={mirror ? 'end' : 'start'} transform={mirror ? `translate(${NECK_W - 10},0)` : undefined}>
              {stringName(r.tuning, s)}
            </text>
          ))}
          {links}
          {(ghosts ?? []).filter(inWin).map((g) => (
            <g key={`g${g.string}:${g.fret}`} class="neck__ghost" data-testid="neck-ghost" data-string={g.string} data-fret={g.fret} onClick={() => onPickGhost?.(g)}>
              <circle class="neck__ghost-hit" cx={mx(noteX(g.fret, w))} cy={yOf(g.string)} r={14} />
              <circle class="neck__ghost-dot" cx={mx(noteX(g.fret, w))} cy={yOf(g.string)} r={9} />
              <text class="neck__dotnum neck__dotnum--ghost" x={mx(noteX(g.fret, w))} y={yOf(g.string) + 3.5} text-anchor="middle">
                {label(g)}
              </text>
            </g>
          ))}
          {[...dots.values()].filter((d) => inWin(d.pos)).map((d) => {
            const first = d.indexes[0]!;
            const cx = mx(noteX(d.pos.fret, w));
            const cy = yOf(d.pos.string);
            const selected = d.indexes.some((i) => {
              const id = r.notes[i]?.id;
              return id !== undefined && sel.has(id);
            });
            return (
              <g
                key={`d${d.pos.string}:${d.pos.fret}`}
                class="neck__dot"
                data-testid="neck-note"
                data-note-index={first}
                data-note-indexes={d.indexes.join(',')}
                data-string={d.pos.string}
                data-fret={d.pos.fret}
                data-selected={selected ? '' : undefined}
              >
                <circle class="neck__dot-c" cx={cx} cy={cy} r={9.5} />
                <text class="neck__dotnum" x={cx} y={cy + 3.5} text-anchor="middle">
                  {label(d.pos)}
                </text>
              </g>
            );
          })}
          <line class="neck__move" data-move style={{ display: 'none' }} x1={0} y1={0} x2={0} y2={0} />
        </g>
      </svg>
      <svg class="neck__mini" viewBox={`0 0 ${MINI_W} ${MINI_H}`} aria-hidden="true" data-testid="neck-mini">
        <rect class="neck__mini-bg" x={0} y={1} width={MINI_W} height={MINI_H - 2} rx={3} />
        <rect class="neck__mini-win" x={Math.min(miniA, miniB)} y={1} width={Math.abs(miniB - miniA)} height={MINI_H - 2} rx={3} />
        {all.map((p, i) => (
          <circle key={i} class="neck__mini-dot" cx={mini(p.fret)} cy={2.5 + ((lowBottom ? n - 1 - p.string : p.string) * (MINI_H - 5)) / Math.max(n - 1, 1)} r={1.4} />
        ))}
      </svg>
    </div>
  );
}
