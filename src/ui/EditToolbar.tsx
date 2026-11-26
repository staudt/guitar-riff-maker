import { redo, redoable, undo, undoable } from '../model/store';
import { play, playing, stop } from '../audio/sync';
import { ZOOM_MAX, ZOOM_MIN, rollZoom } from './rollGeometry';
import { IconButton, Toggle } from './primitives';
import './editor.css';

export interface EditToolbarProps {
  snapScale: boolean;
  onSnapScale: (on: boolean) => void;
}

// One compact row: hear the riff while editing, undo/redo, scale snap.
// The grid (1/8 vs 1/16) is detected from the take; key, tempo and the rest live in RiffSettingsSheet.
export function EditToolbar(props: EditToolbarProps) {
  const { snapScale, onSnapScale } = props;
  const on = playing.value;
  const z = rollZoom.value;
  const zoom = (f: number) => (rollZoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * f).toFixed(3))));
  return (
    <div class="toolbar" data-testid="edit-toolbar">
      <button
        class={`toolbar__play${on ? ' toolbar__play--on' : ''}`}
        aria-label={on ? 'Stop' : 'Play'}
        aria-pressed={on}
        data-testid="tb-play"
        onClick={() => (on ? stop() : void play(0, false))}
      >
        {on ? '■' : '▶'} <span>{on ? 'Stop' : 'Play'}</span>
      </button>
      <IconButton label="Undo" glyph="↶" onPress={undo} disabled={!undoable.value} testId="tb-undo" />
      <IconButton label="Redo" glyph="↷" onPress={redo} disabled={!redoable.value} testId="tb-redo" />
      <button class="toolbar__zoom" aria-label="Zoom out" data-testid="tb-zoom-out" disabled={z <= ZOOM_MIN} onClick={() => zoom(1 / 1.4)}>−</button>
      <button class="toolbar__zoom" aria-label="Zoom in" data-testid="tb-zoom-in" disabled={z >= ZOOM_MAX} onClick={() => zoom(1.4)}>+</button>
      <Toggle label="Snap" on={snapScale} onChange={onSnapScale} testId="tb-snap" />
    </div>
  );
}
