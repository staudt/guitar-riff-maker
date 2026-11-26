import { redo, redoable, riff, selection, undo, undoable } from '../model/store';
import { play, playing, rate, stop } from '../audio/sync';
import { ZOOM_MAX, ZOOM_MIN, rollZoom } from './rollGeometry';
import './editor.css';

const RATES = [1, 0.75, 0.5];

/** Step to start from: the selected note when exactly one is selected, else the top. */
function startStep(): number {
  const sel = selection.value;
  if (sel.size !== 1) return 0;
  const [id] = sel;
  return riff.value.notes.find((n) => n.id === id)?.step ?? 0;
}

// One compact row: play, practice speed, undo/redo, zoom. Scale snap lives in the settings sheet.
export function EditToolbar() {
  const on = playing.value;
  const z = rollZoom.value;
  const zoom = (f: number) => (rollZoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * f).toFixed(3))));
  const pct = Math.round(rate.value * 100);
  const cycleRate = () => (rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length] ?? 1);
  return (
    <div class="toolbar" data-testid="edit-toolbar">
      <button
        class={`toolbar__play${on ? ' toolbar__play--on' : ''}`}
        aria-label={on ? 'Stop' : 'Play'}
        aria-pressed={on}
        data-testid="tb-play"
        onClick={() => (on ? stop() : void play(startStep(), false))}
      >
        <span aria-hidden="true">{on ? '■' : '▶'}</span> <span class="toolbar__play-text">{on ? 'Stop' : 'Play'}</span>
      </button>
      <button class="toolbar__chip" aria-label={`Playback speed ${pct}%, tap to change`} data-testid="tb-speed" onClick={cycleRate}>
        {pct}%
      </button>
      <button class="toolbar__sq" aria-label="Undo" data-testid="tb-undo" disabled={!undoable.value} onClick={undo}>↶</button>
      <button class="toolbar__sq" aria-label="Redo" data-testid="tb-redo" disabled={!redoable.value} onClick={redo}>↷</button>
      <button class="toolbar__sq" aria-label="Zoom out" data-testid="tb-zoom-out" disabled={z <= ZOOM_MIN} onClick={() => zoom(1 / 1.4)}>−</button>
      <button class="toolbar__sq" aria-label="Zoom in" data-testid="tb-zoom-in" disabled={z >= ZOOM_MAX} onClick={() => zoom(1.4)}>+</button>
    </div>
  );
}
