import { useRef, useState } from 'preact/hooks';
import { editUnit, isFree, stepSeconds, totalSteps } from '../model/riff';
import { dispatch, riff, selection } from '../model/store';
import { midiToNote } from '../music/notation';
import { inScale } from '../music/theory';
import { audition } from './audition';
import { TraceLayer } from './TraceLayer';
import { snapEnd, snapMove, traceBounds, traceRange, unclaimedSpanNear } from './traceGeometry';
import {
  HANDLE_H,
  HANDLE_W,
  HIT_RADIUS,
  LABEL_W,
  ROW_H,
  RULER_H,
  TRACE_HIT_RADIUS,
  dragMidi,
  dragSlop,
  dragStepDelta,
  isCRow,
  isDoubleTap,
  isTap,
  midiToRowPos,
  nearestNote,
  noteBox,
  pitchRange,
  pxPerStep,
  rollZoom,
  setRollStepX,
  rowMidis,
  xToStep,
  type TapStamp,
} from './rollGeometry';
import './editor.css';

export interface RollEditorProps {
  /** Hide out-of-key rows instead of dimming them. */
  snapScale?: boolean;
}

const SNAP_TOL = 4; // ticks: how close an edge must be to a trace segment boundary to snap to it
/** Length of a note added by double-tapping empty space in a free riff: 250 ms. */
const FREE_ADD_LEN = 25;

// One pointer at a time. A "tap" gesture is only a candidate: it is resolved on release by hit testing,
// so a wobbling finger still selects. Only the selected note (and its handles) can be dragged.
type Gesture =
  | { kind: 'tap'; pid: number; type: string; x0: number; y0: number; t0: number; maxd: number; gx: number; gy: number }
  | { kind: 'move'; pid: number; type: string; id: string; x0: number; y0: number; maxd: number; started: boolean; step0: number; len0: number; midi0: number; lastMidi: number; bounds: number[] }
  | { kind: 'edge'; pid: number; type: string; side: 'l' | 'r'; id: string; x0: number; y0: number; t0: number; maxd: number; changed: boolean; step0: number; len0: number; bounds: number[]; floor: number; gx: number; gy: number };

export function RollEditor(props: RollEditorProps) {
  const { snapScale = false } = props;
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
  const gesture = useRef<Gesture | null>(null);
  const lastEmptyTap = useRef<TapStamp | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Pointer position in grid coordinates: x from step 0, y from the first row. */
  const local = (e: PointerEvent) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - LABEL_W, y: e.clientY - rect.top - top };
  };
  const noteById = (id: string) => riff.peek().notes.find((n) => n.id === id);
  const key = (id: string) => ({ coalesceKey: `drag:${id}` });

  const end = () => {
    gesture.current = null;
    setDragging(false);
  };

  const select = (id: string) => {
    selection.value = new Set([id]);
    const n = noteById(id);
    if (n) audition([n.midi], n.velocity);
  };

  /** A resolved tap at grid position (gx, gy). */
  const onTap = (gx: number, gy: number, t: number) => {
    const cur = riff.peek();
    const boxes = cur.notes.flatMap((n) => {
      const ri = rowIndex.get(n.midi);
      return ri === undefined ? [] : [noteBox(n, ri, px)];
    });
    const hit = nearestNote(boxes, gx, gy, HIT_RADIUS);
    if (hit) {
      lastEmptyTap.current = null;
      select(hit);
      return;
    }
    if (free) {
      // Tapping an unclaimed piece of the recorded line adds the note it was meant to be.
      const span = unclaimedSpanNear(cur, (m) => midiToRowPos(rows, m), px, ROW_H, gx, gy, TRACE_HIT_RADIUS);
      if (span) {
        lastEmptyTap.current = null;
        dispatch({ type: 'add', step: span.step, length: span.length, midi: span.midi, src: span });
        audition([span.midi]);
        return;
      }
    }
    // Empty space: deselect; a quick second tap nearby adds a note.
    const stamp = { t, x: gx, y: gy };
    if (!isDoubleTap(lastEmptyTap.current, stamp)) {
      lastEmptyTap.current = stamp;
      if (selection.peek().size) selection.value = new Set();
      return;
    }
    lastEmptyTap.current = null;
    const row = rows[Math.max(0, Math.min(rows.length - 1, Math.floor(gy / ROW_H)))];
    if (row === undefined) return;
    const step = xToStep(gx, unit, total, px);
    const length = free ? Math.min(FREE_ADD_LEN, total - step) : unit;
    if (length < 1) return;
    dispatch({ type: 'add', step, midi: row, length });
    audition([row]);
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gesture.current && gesture.current.pid !== e.pointerId) {
      end(); // a second finger: it is a pinch or scroll, not an edit
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('.roll__label')) return;
    const { x, y } = local(e);
    const base = { pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, maxd: 0 };
    const handle = target.closest<HTMLElement>('[data-handle]');
    const noteEl = target.closest<HTMLElement>('.roll__note');
    const id = handle?.dataset.noteId ?? noteEl?.dataset.noteId;
    const n = id ? noteById(id) : undefined;
    const grid = gridRef.current!;
    if (handle && n) {
      const side = handle.dataset.handle === 'l' ? 'l' : 'r';
      const cur = riff.peek();
      const prev = cur.notes.filter((o) => o.id !== n.id && o.step < n.step).reduce((m, o) => Math.max(m, o.step + o.length), 0);
      try { grid.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      gesture.current = { ...base, kind: 'edge', side, id: n.id, t0: e.timeStamp, changed: false, step0: n.step, len0: n.length, bounds: free ? traceBounds(cur, n.id) : [], floor: Math.min(prev, n.step), gx: x, gy: y };
      setDragging(true);
    } else if (noteEl && n && sel.has(n.id)) {
      try { grid.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      gesture.current = { ...base, kind: 'move', id: n.id, started: false, step0: n.step, len0: n.length, midi0: n.midi, lastMidi: n.midi, bounds: free ? traceBounds(riff.peek(), n.id) : [] };
    } else {
      // Not captured: if the browser takes the touch to scroll it sends pointercancel and no tap happens.
      gesture.current = { ...base, kind: 'tap', t0: e.timeStamp, gx: x, gy: y };
    }
  };

  const onMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pid !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    g.maxd = Math.max(g.maxd, Math.hypot(dx, dy));
    if (g.kind === 'move') {
      if (!g.started) {
        if (g.maxd < dragSlop(g.type)) return;
        g.started = true;
        setDragging(true);
      }
      const cur = noteById(g.id);
      if (!cur) return;
      const raw = free ? snapMove(g.step0, g.len0, dx / px, unit, g.bounds, SNAP_TOL) : g.step0 + dragStepDelta(dx, unit, px);
      const step = Math.max(0, Math.min(total - 1, raw));
      if (step !== cur.step) dispatch({ type: 'move', id: g.id, step }, key(g.id));
      const midi = dragMidi(rows, g.midi0, dy);
      if (midi !== g.lastMidi) {
        g.lastMidi = midi;
        dispatch({ type: 'setPitch', id: g.id, midi }, key(g.id));
        audition([midi]);
      }
    } else if (g.kind === 'edge') {
      const cur = noteById(g.id);
      if (!cur) return;
      const endStep = g.step0 + g.len0;
      if (g.side === 'r') {
        const e2 = snapEnd(endStep + dx / px, unit, g.bounds, SNAP_TOL);
        const length = Math.min(total - g.step0, Math.max(unit, e2 - g.step0));
        if (cur.length !== length) {
          g.changed = true;
          dispatch({ type: 'resize', id: g.id, length }, key(g.id));
        }
      } else {
        const s0 = snapEnd(g.step0 + dx / px, unit, g.bounds, SNAP_TOL);
        const start = Math.max(g.floor, Math.min(endStep - Math.min(unit, g.len0), s0));
        if (start !== cur.step) {
          g.changed = true;
          dispatch({ type: 'move', id: g.id, step: start }, key(g.id));
          dispatch({ type: 'resize', id: g.id, length: endStep - start }, key(g.id));
        }
      }
    }
  };

  const onUp = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pid !== e.pointerId) return;
    end();
    if (e.type !== 'pointerup') return; // cancelled: the browser took it to scroll
    if (g.kind === 'tap' && isTap(g.maxd, e.timeStamp - g.t0, g.type)) onTap(g.gx, g.gy, e.timeStamp);
    // A tap on a handle that did not resize falls through to hit testing (it may cover a neighbour).
    if (g.kind === 'edge' && !g.changed && isTap(g.maxd, e.timeStamp - g.t0, g.type)) onTap(g.gx, g.gy, e.timeStamp);
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

  const selNotes = r.notes.filter((n) => sel.has(n.id) && rowIndex.has(n.midi));

  return (
    <div class="roll" data-testid="roll" data-free={free || undefined} data-dragging={dragging || undefined}>
      <div class="roll__scroller">
        <div
          ref={gridRef}
          class="roll__grid"
          style={{ width: `${width}px`, height: `${height}px` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {free ? <div class="roll__ruler" style={{ width: `${width}px` }}>{ticks}</div> : null}
          {rows.map((m, i) => (
            <div
              key={m}
              class={`roll__row ${isCRow(m) ? 'roll__row--c' : ''} ${inScale(m, r.key.tonic, r.key.scale) ? '' : 'roll__row--out'}`}
              style={{ top: `${top + i * ROW_H}px`, height: `${ROW_H}px` }}
            >
              <span class="roll__label">{midiToNote(m)}</span>
            </div>
          ))}
          {lines}
          {r.trace ? <TraceLayer riff={r} rows={rows} px={px} left={LABEL_W} top={top} width={width} height={height} /> : null}
          {r.notes.map((n, i) => {
            const ri = rowIndex.get(n.midi);
            if (ri === undefined) return null;
            const selected = sel.has(n.id);
            const b = noteBox(n, ri, px);
            return (
              <div
                key={n.id}
                class={`roll__note ${free ? 'roll__note--free' : ''} ${selected ? 'roll__note--sel' : ''}`}
                data-testid="roll-note"
                data-note-index={i}
                data-note-id={n.id}
                style={{ left: `${LABEL_W + b.x}px`, top: `${top + b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
              />
            );
          })}
          {selNotes.map((n) => {
            const b = noteBox(n, rowIndex.get(n.midi)!, px);
            const y = top + b.y + b.h / 2 - HANDLE_H / 2;
            return [
              <div
                key={`${n.id}-l`}
                class="roll__edge roll__edge--l"
                data-testid="roll-handle-l"
                data-handle="l"
                data-note-id={n.id}
                style={{ left: `${LABEL_W + b.x - HANDLE_W}px`, top: `${y}px`, width: `${HANDLE_W}px`, height: `${HANDLE_H}px` }}
              />,
              <div
                key={`${n.id}-r`}
                class="roll__edge roll__edge--r"
                data-testid="roll-handle"
                data-handle="r"
                data-note-id={n.id}
                style={{ left: `${LABEL_W + b.x + b.w}px`, top: `${y}px`, width: `${HANDLE_W}px`, height: `${HANDLE_H}px` }}
              />,
            ];
          })}
          <div class="roll__playhead" data-playhead style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  );
}
