import { useState } from 'preact/hooks';
import type { GridSize } from '../model/riff';
import { dispatch, redo, redoable, riff, undo, undoable } from '../model/store';
import { pcName, SCALES } from '../music/theory';
import type { PitchClass, ScaleName } from '../music/types';
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
const KEY_MODES = [
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'diatonic', label: 'Diatonic' },
];

export function EditToolbar(props: EditToolbarProps) {
  const { snapScale, onSnapScale } = props;
  const r = riff.value;
  const [mode, setMode] = useState<'chromatic' | 'diatonic'>('chromatic');

  const shiftKey = (dir: -1 | 1) =>
    dispatch(mode === 'chromatic' ? { type: 'transpose', semis: dir } : { type: 'transposeDiatonic', steps: dir });

  return (
    <div class="toolbar" data-testid="edit-toolbar">
      <div class="toolbar__row">
        <IconButton label="Undo" glyph="↶" onPress={undo} disabled={!undoable.value} testId="tb-undo" />
        <IconButton label="Redo" glyph="↷" onPress={redo} disabled={!redoable.value} testId="tb-redo" />
        <Segmented
          options={GRIDS}
          value={r.grid}
          onChange={(grid) => dispatch({ type: 'setGrid', grid })}
          testId="tb-grid"
        />
        <Toggle label="Snap" on={snapScale} onChange={onSnapScale} testId="tb-snap" />
        {r.capture ? (
          <button
            type="button"
            class="toolbar__btn"
            data-testid="tb-requantize"
            onClick={() => dispatch({ type: 'requantize', grid: r.grid })}
          >
            Requantize
          </button>
        ) : null}
      </div>
      <div class="toolbar__row">
        <div class="toolbar__group" role="group" aria-label="Key">
          <IconButton label={mode === 'chromatic' ? 'Key down' : 'Down a scale step'} glyph="◀" onPress={() => shiftKey(-1)} testId="tb-key-dec" />
          <span class="toolbar__value" data-testid="tb-key">{pcName(r.key.tonic)}</span>
          <IconButton label={mode === 'chromatic' ? 'Key up' : 'Up a scale step'} glyph="▶" onPress={() => shiftKey(1)} testId="tb-key-inc" />
        </div>
        <Segmented
          options={KEY_MODES}
          value={mode}
          onChange={(m) => setMode(m as 'chromatic' | 'diatonic')}
          testId="tb-key-mode"
        />
        <select
          class="toolbar__select"
          aria-label="Scale"
          data-testid="tb-scale"
          value={r.key.scale}
          onChange={(e) =>
            dispatch({
              type: 'setKey',
              tonic: r.key.tonic as PitchClass,
              scale: e.currentTarget.value as ScaleName,
              moveNotes: false,
            })
          }
        >
          {(Object.keys(SCALES) as ScaleName[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="button" class="toolbar__btn" data-testid="tb-fix-key" onClick={() => dispatch({ type: 'fixOutOfKey' })}>
          Fix out-of-key
        </button>
        <div class="toolbar__group" role="group" aria-label="Tempo">
          <IconButton label="Slower" glyph="−" onPress={() => dispatch({ type: 'setBpm', bpm: r.bpm - 1 })} testId="tb-bpm-dec" />
          <span class="toolbar__value" data-testid="tb-bpm">♩ {r.bpm}</span>
          <IconButton label="Faster" glyph="+" onPress={() => dispatch({ type: 'setBpm', bpm: r.bpm + 1 })} testId="tb-bpm-inc" />
        </div>
      </div>
    </div>
  );
}
