import { useRef, useState } from 'preact/hooks';
import { editUnit, isFree, stepSeconds, totalSteps } from '../model/riff';
import { dispatch, riff, selection } from '../model/store';
import { midiToNote } from '../music/notation';
import { inScale } from '../music/theory';
import { audition } from './audition';
import { TraceLayer } from './TraceLayer';
import { snapEnd, snapMove, traceBounds, traceRange, unclaimedSpanAt } from './traceGeometry';
import {
  DRAG_SLOP,
  LABEL_W,
  LONG_PRESS_MS,
  ROW_H,
  RULER_H,
  dragMidi,
  dragStepDelta,
  isCRow,
  notesInRange,
  pitchRange,
  pxPerStep,
  resizeLength,
  rollZoom,
  setRollStepX,
  rowMidis,
  xToStep,
  yToRow,
} from './rollGeometry';
import './editor.css';

export interface RollEditorProps {
  /** Hide out-of-key rows instead of dimming them. */
  snapScale?: boolean;
  /** Called when a note is tapped (it is also selected). */
  onOpenNote?: (id: string) => void;
  /** Called when a long-press range selection ends. */
  onRange?: (startStep: number, endStep: number) => void;
}

type EmptyDrag = { kind: 'empty'; x0: number; y0: number; gx: number; gy: number; timer: number; range: boolean; anchor: number; end: number };
const SNAP_TOL = 4; // ticks: how close an edge must be to a trace segment boundary to snap to it
type Drag =
  | { kind: 'note'; id: string; x0: number; y0: number; step0: number; len0: number; midi0: number; moved: boolean; lastMidi: number; bounds: number[] }
  | { kind: 'resize'; id: string; x0: number; step0: number; len0: number; bounds: number[] }
  | EmptyDrag;

export function RollEditor(props: RollEditorProps) {
  const { snapScale = false, onOpenNote, onRange } = props;
  const r = riff.value;
  const sel = selection.value;
  const total = totalSteps(r);
  const free = isFree(r);
  const unit = editUnit(r);
  const px = pxPerStep(r, rollZoom.value);
  setRollStepX(px);
  const top = free ? RULER_H : 0;
  const midis = r.notes.map((n) => n.midi);
  const tr = traceRange(r);
  const { lo, hi } = pitchRange(tr ? [...midis, Math.floor(tr.lo), Math.ceil(tr.hi)] : midis, tr ? 2 : 3);
  const rows = rowMidis(lo, hi, r.key, snapScale, midis);
  const rowIndex = new Map(rows.map((m, i) => [m, i]));
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const local = (e: PointerEvent) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - LABEL_W, y: e.clientY - rect.top - top };
  };
  const noteById = (id: string) => riff.peek().notes.find((n) => n.id === id);

  const endDrag = () => {
    const d = drag.current;
    if (d?.kind === 'empty') window.clearTimeout(d.timer);
    drag.current = null;
    setDragging(false);
    setRange(null);
  };

  // ---- notes ----
  const onNoteDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    const n = noteById(id);
    if (!n) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'note', id, x0: e.clientX, y0: e.clientY, step0: n.step, len0: n.length, midi0: n.midi, moved: false, lastMidi: n.midi, bounds: free ? traceBounds(riff.peek(), id) : [] };
  };
  const onNoteMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'note') return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    const cur = noteById(d.id);
    if (!cur) return;
    const raw = free ? snapMove(d.step0, d.len0, dx / px, unit, d.bounds, SNAP_TOL) : d.step0 + dragStepDelta(dx, unit, px);
    const step = Math.max(0, Math.min(total - 1, raw));
    if (step !== cur.step) dispatch({ type: 'move', id: d.id, step });
    const midi = dragMidi(rows, d.midi0, dy);
    if (midi !== d.lastMidi) {
      d.lastMidi = midi;
      dispatch({ type: 'setPitch', id: d.id, midi });
      audition([midi]);
    }
  };
  const onNoteUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'note') return;
    const tap = !d.moved;
    endDrag();
    if (tap && e.type === 'pointerup') {
      selection.value = new Set([d.id]);
      onOpenNote?.(d.id);
    }
  };

  // ---- resize ----
  const onHandleDown = (e: PointerEvent, id: string) => {
    e.stopPropagation();
    const n = noteById(id);
    if (!n) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: 'resize', id, x0: e.clientX, step0: n.step, len0: n.length, bounds: free ? traceBounds(riff.peek(), id) : [] };
    setDragging(true);
  };
  const onHandleMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'resize') return;
    const end = snapEnd(d.step0 + d.len0 + (e.clientX - d.x0) / px, unit, d.bounds, SNAP_TOL);
    const length = Math.min(total - d.step0, Math.max(unit, end - d.step0));
    const cur = noteById(d.id);
    if (cur && cur.length !== length) dispatch({ type: 'resize', id: d.id, length });
  };
  const onHandleUp = (e: PointerEvent) => {
    e.stopPropagation();
    endDrag();
  };

  // ---- empty area: tap to add, long-press then drag to range-select ----
  const onGridDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { x, y } = local(e);
    if (x < 0 || y < 0) return;
    const el = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    const d: EmptyDrag = {
      kind: 'empty', x0: e.clientX, y0: e.clientY, gx: x, gy: y, range: false, anchor: 0, end: 0,
      timer: window.setTimeout(() => {
        d.range = true;
        d.anchor = xToStep(d.gx, 1, total, px);
        d.end = d.anchor;
        try { el.setPointerCapture(pid); } catch { /* pointer already gone */ }
        setDragging(true);
        setRange({ a: d.anchor, b: d.end });
        selection.value = new Set(notesInRange(riff.peek().notes, d.anchor, d.end));
      }, LONG_PRESS_MS),
    };
    drag.current = d;
  };
  const onGridMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'empty') return;
    if (!d.range) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= DRAG_SLOP) {
        window.clearTimeout(d.timer);
        drag.current = null; // it is a scroll, not a tap
      }
      return;
    }
    e.preventDefault();
    d.end = xToStep(local(e).x, 1, total, px);
    setRange({ a: d.anchor, b: d.end });
    selection.value = new Set(notesInRange(riff.peek().notes, d.anchor, d.end));
  };
  const onGridUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'empty') return;
    const wasRange = d.range;
    const { anchor, end } = d;
    const { gx, gy } = d;
    endDrag();
    if (e.type !== 'pointerup') return;
    if (wasRange) {
      onRange?.(Math.min(anchor, end), Math.max(anchor, end) + 1);
      return;
    }
    const row = rows[yToRow(gy, rows.length)];
    if (row === undefined) return;
    if (free) {
      // Tapping an unclaimed piece of the recorded line adds the note it was meant to be.
      const span = unclaimedSpanAt(riff.peek(), gx / px);
      if (span) {
        const act = { type: 'add' as const, step: span.step, length: span.length, midi: span.midi, src: span };
        dispatch(act);
        audition([span.midi]);
        return;
      }
      const step = xToStep(gx, unit, total, px);
      dispatch({ type: 'add', step, midi: row, length: Math.min(unit * 5, total - step) });
    } else {
      dispatch({ type: 'add', step: xToStep(gx, unit, total, px), midi: row });
    }
    audition([row]);
  };

  const width = LABEL_W + total * px;
  const rowsH = rows.length * ROW_H;
  const height = top + rowsH;
  const lines: preact.JSX.Element[] = [];
  const ticks: preact.JSX.Element[] = [];
  if (free) {
    // Seconds ruler: a label every 0.5 s, thinned when zoomed out.
    const perSec = 1 / stepSeconds(r);
    const every = px * perSec * 0.5 < 34 ? 1 : 0.5;
    for (let t = 0; t * perSec <= total; t += every) {
      const x = LABEL_W + t * perSec * px;
      ticks.push(<span key={t} class="roll__tick" style={{ left: `${x}px` }}>{`${t}s`}</span>);
      lines.push(<div key={t} class="roll__line" style={{ left: `${x}px`, top: `${top}px` }} />);
    }
  } else {
    for (let s = 0; s <= total; s += 4) {
      lines.push(<div key={s} class={`roll__line ${s % 16 === 0 ? 'roll__line--bar' : ''}`} style={{ left: `${LABEL_W + s * px}px` }} />);
    }
  }

  return (
    <div class="roll" data-testid="roll" data-free={free || undefined} data-dragging={dragging || undefined}>
      <div class="roll__scroller">
        <div
          ref={gridRef}
          class="roll__grid"
          style={{ width: `${width}px`, height: `${height}px` }}
          onPointerDown={onGridDown}
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          onPointerCancel={onGridUp}
        >
          {free ? <div class="roll__ruler" style={{ width: `${width}px` }}>{ticks}</div> : null}
          {rows.map((m, i) => (
            <div
              key={m}
              class={`roll__row ${isCRow(m) ? 'roll__row--c' : ''} ${inScale(m, r.key.tonic, r.key.scale) ? '' : 'roll__row--out'}`}
              style={{ top: `${top + i * ROW_H}px` }}
            >
              <span class="roll__label">{midiToNote(m)}</span>
            </div>
          ))}
          {lines}
          {r.trace ? <TraceLayer riff={r} rows={rows} px={px} left={LABEL_W} top={top} width={width} height={height} /> : null}
          {range ? (
            <div
              class="roll__range"
              style={{
                left: `${LABEL_W + Math.min(range.a, range.b) * px}px`,
                width: `${(Math.abs(range.b - range.a) + 1) * px}px`,
              }}
            />
          ) : null}
          {r.notes.map((n, i) => {
            const ri = rowIndex.get(n.midi);
            if (ri === undefined) return null;
            const selected = sel.has(n.id);
            return (
              <div
                key={n.id}
                class={`roll__note ${free ? 'roll__note--free' : ''} ${selected ? 'roll__note--sel' : ''}`}
                data-testid="roll-note"
                data-note-index={i}
                data-note-id={n.id}
                style={{
                  left: `${LABEL_W + n.step * px + 1}px`,
                  top: `${top + ri * ROW_H + 2}px`,
                  width: `${Math.max(4, n.length * px - 2)}px`,
                }}
                onPointerDown={(e) => onNoteDown(e, n.id)}
                onPointerMove={onNoteMove}
                onPointerUp={onNoteUp}
                onPointerCancel={onNoteUp}
              >
                <div
                  class="roll__handle"
                  data-testid="roll-handle"
                  onPointerDown={(e) => onHandleDown(e, n.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                />
              </div>
            );
          })}
          <div class="roll__playhead" data-playhead style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  );
}
