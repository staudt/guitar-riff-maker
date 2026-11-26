import type { GridSize } from '../model/riff';
import { dispatch, redo, redoable, riff, undo, undoable } from '../model/store';
import { IconButton, Segmented, Toggle } from './primitives';
import './editor.css';

export interface EditToolbarProps {
  snapScale: boolean;
  onSnapScale: (on: boolean) => void;
}

const GRIDS = [
  { value: 8 as GridSize, label: '1/8' },
  { value: 16 as GridSize, label: '1/16' },
];

// One compact row. Key, scale, tempo, fix-out-of-key and requantize live in RiffSettingsSheet.
export function EditToolbar(props: EditToolbarProps) {
  const { snapScale, onSnapScale } = props;
  const r = riff.value;
  return (
    <div class="toolbar" data-testid="edit-toolbar">
      <IconButton label="Undo" glyph="↶" onPress={undo} disabled={!undoable.value} testId="tb-undo" />
      <IconButton label="Redo" glyph="↷" onPress={redo} disabled={!redoable.value} testId="tb-redo" />
      <Segmented options={GRIDS} value={r.grid} onChange={(grid) => dispatch({ type: 'setGrid', grid })} testId="tb-grid" />
      <Toggle label="Snap" on={snapScale} onChange={onSnapScale} testId="tb-snap" />
    </div>
  );
}
