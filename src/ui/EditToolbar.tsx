import { redo, redoable, undo, undoable } from '../model/store';
import { play, playing, stop } from '../audio/sync';
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
      <Toggle label="Snap" on={snapScale} onChange={onSnapScale} testId="tb-snap" />
    </div>
  );
}
