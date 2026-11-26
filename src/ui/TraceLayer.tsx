// The recorded pitch line under the roll's notes (cyan). Claimed pieces follow their note; unclaimed ones are dim.
import type { Riff } from '../model/riff';
import { ROW_H, midiToRowPos } from './rollGeometry';
import { demoFreeRiff } from '../model/demo';
import { loadRiff } from '../model/store';
import { traceSegments } from './traceGeometry';

export interface TraceLayerProps {
  riff: Riff;
  /** Visible rows, highest first. */
  rows: readonly number[];
  /** Horizontal pixels per step. */
  px: number;
  /** x offset of step 0 and y offset of the first row. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export function TraceLayer(props: TraceLayerProps) {
  const { riff, rows, px, left, top, width, height } = props;
  const segs = traceSegments(riff);
  if (!segs.length) return null;
  return (
    <svg class="roll__trace" data-testid="trace-layer" width={width} height={height} style={{ top: 0, left: 0 }} aria-hidden="true">
      {segs.map((s, i) => {
        const pts = s.points.map((p) => `${(left + p.x * px).toFixed(1)} ${(top + (midiToRowPos(rows, p.y) + 0.5) * ROW_H).toFixed(1)}`);
        const d = pts.length === 1 ? `M${pts[0]} h0.1` : `M${pts.join('L')}`;
        return <path key={i} d={d} class={s.claimed ? 'roll__trace-seg' : 'roll__trace-seg roll__trace-seg--dim'} data-claimed={s.claimed ? 'true' : 'false'} data-note-id={s.noteId} />;
      })}
    </svg>
  );
}

// Dev-only: load the free-timing demo from the console / Playwright (the app boots from IndexedDB).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __loadFreeDemo?: () => void }).__loadFreeDemo = () => loadRiff(demoFreeRiff());
}
