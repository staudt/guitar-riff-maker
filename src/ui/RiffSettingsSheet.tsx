// Everything that used to crowd the toolbar: key/scale, tempo, power chords, instrument, bars, export.
import { useState } from 'preact/hooks';
import { dispatch, riff } from '../model/store';
import { pcName, SCALES } from '../music/theory';
import type { PitchClass, ScaleName } from '../music/types';
import { MAX_BARS, type Instrument, type PowerMode } from '../model/riff';
import { exportJson, shareTab } from '../model/export';
import { keyMode, moreOpen, type KeyMode } from '../app/ui-state';
import { IconButton, Segmented, Sheet } from './primitives';
import './editor.css';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'riff'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Row(props: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="rs-row">
      <span class="rs-row__label">{props.label}</span>
      <div class="rs-row__ctl">{props.children}</div>
    </div>
  );
}

export function shiftKey(dir: -1 | 1): void {
  dispatch(keyMode.value === 'chromatic' ? { type: 'transpose', semis: dir } : { type: 'transposeDiatonic', steps: dir });
}

export function RiffSettingsSheet() {
  const r = riff.value;
  const [status, setStatus] = useState('');
  const mode = keyMode.value;
  const free = r.timing === 'free';

  const share = async () => {
    try {
      const res = await shareTab(riff.peek());
      setStatus(res === 'copied' ? 'Copied!' : res === 'downloaded' ? 'Downloaded' : 'Shared');
    } catch {
      setStatus('');
    }
  };

  return (
    <Sheet open={moreOpen.value} onClose={() => (moreOpen.value = false)} title="Riff settings" testId="riff-settings">
      <Row label="Key">
        <IconButton label={mode === 'chromatic' ? 'Key down' : 'Down a scale step'} glyph="◀" onPress={() => shiftKey(-1)} testId="tb-key-dec" />
        <span class="rs-value" data-testid="tb-key">{pcName(r.key.tonic)}</span>
        <IconButton label={mode === 'chromatic' ? 'Key up' : 'Up a scale step'} glyph="▶" onPress={() => shiftKey(1)} testId="tb-key-inc" />
        <select
          class="toolbar__select"
          aria-label="Scale"
          data-testid="tb-scale"
          value={r.key.scale}
          onChange={(e) =>
            dispatch({ type: 'setKey', tonic: r.key.tonic as PitchClass, scale: e.currentTarget.value as ScaleName, moveNotes: false })
          }
        >
          {(Object.keys(SCALES) as ScaleName[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Key steps">
        <Segmented<KeyMode>
          testId="tb-key-mode"
          options={[
            { value: 'chromatic', label: 'Chromatic' },
            { value: 'diatonic', label: 'Diatonic' },
          ]}
          value={mode}
          onChange={(m) => (keyMode.value = m)}
        />
      </Row>
      {!free && (
      <>
      <Row label="Tempo">
        <IconButton label="Slower" glyph="−" onPress={() => dispatch({ type: 'setBpm', bpm: r.bpm - 1 })} testId="tb-bpm-dec" />
        <span class="rs-value" data-testid="tb-bpm">♩ {r.bpm}</span>
        <IconButton label="Faster" glyph="+" onPress={() => dispatch({ type: 'setBpm', bpm: r.bpm + 1 })} testId="tb-bpm-inc" />
      </Row>
      <Row label="Bars">
        <IconButton label="Fewer bars" glyph="−" disabled={r.bars <= 1} onPress={() => dispatch({ type: 'setBars', bars: r.bars - 1 })} testId="riff-bars-dec" />
        <span class="rs-value" data-testid="riff-bars">{r.bars}</span>
        <IconButton label="More bars" glyph="+" disabled={r.bars >= MAX_BARS} onPress={() => dispatch({ type: 'setBars', bars: r.bars + 1 })} testId="riff-bars-inc" />
      </Row>
      </>
      )}
      <Row label="Power chords">
        <Segmented<PowerMode>
          testId="ctl-power"
          value={r.power}
          options={[
            { value: 'off', label: 'off' },
            { value: 'r5', label: '5' },
            { value: 'r58', label: '8' },
          ]}
          onChange={(power) => dispatch({ type: 'setPower', power })}
        />
      </Row>
      <Row label="Sound">
        <Segmented<Instrument>
          testId="instrument"
          value={r.instrument}
          options={[
            { value: 'clean', label: 'Clean' },
            { value: 'drive', label: 'Drive' },
            { value: 'guide', label: 'Guide' },
          ]}
          onChange={(v) => dispatch({ type: 'setInstrument', instrument: v })}
        />
      </Row>
      <div class="rs-actions">
        <button type="button" class="toolbar__btn" data-testid="tb-fix-key" onClick={() => dispatch({ type: 'fixOutOfKey' })}>
          Fix out-of-key
        </button>
        {free ? (
          <>
            <button type="button" class="toolbar__btn" data-testid="snap-to-beat" onClick={() => dispatch({ type: 'snapToBeat' })}>
              Snap to beat
            </button>
            <p class="rs-status">Fits the notes to a steady tempo (adds bars, metronome)</p>
          </>
        ) : r.capture ? (
          <button type="button" class="toolbar__btn" data-testid="tb-requantize" onClick={() => dispatch({ type: 'requantize', grid: r.grid })}>
            Requantize
          </button>
        ) : null}
        <button type="button" class="toolbar__btn" data-testid="share-tab" onClick={() => void share()}>
          Share tab
        </button>
        <button type="button" class="toolbar__btn" data-testid="export-json" onClick={() => download(r.name, exportJson(riff.peek()))}>
          Export JSON
        </button>
      </div>
      <p class="rs-status" role="status" data-testid="share-status">
        {status}
      </p>
    </Sheet>
  );
}
