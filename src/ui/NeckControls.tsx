// One controls row under the neck: [key ◀▶] [oct ±] [pos ◀▶] [⇋]. Power chords live in the settings sheet.
import './primitives';
import './views.css';
import { dispatch, riff } from '../model/store';
import { fingering } from '../model/fingering';
import { canOctave } from '../model/edit';
import { rangeOf } from '../music/tuning';
import { pcName } from '../music/theory';
import { IconButton } from './primitives';
import { lefty, setSetting } from '../app/settings';
import { shiftKey } from './RiffSettingsSheet';

function Step(props: { label: string; value: string; id: string; onDec: () => void; onInc: () => void; decOff?: boolean; incOff?: boolean; decText?: string; incText?: string }) {
  const { label, value, id, onDec, onInc, decOff, incOff, decText = '◀', incText = '▶' } = props;
  return (
    <div class="ui-stepper ctl" role="group" aria-label={label}>
      <button type="button" class="ui-stepper__btn" aria-label={`Decrease ${label}`} data-testid={`${id}-dec`} disabled={decOff} onClick={onDec}>
        {decText}
      </button>
      <span class="ui-stepper__value" data-testid={id} aria-live="polite">
        {value}
      </span>
      <button type="button" class="ui-stepper__btn" aria-label={`Increase ${label}`} data-testid={`${id}-inc`} disabled={incOff} onClick={onInc}>
        {incText}
      </button>
    </div>
  );
}

const SHORT: Record<string, string> = { minor: 'min', major: 'maj', dorian: 'dor', mixolydian: 'mix', pentatonic: 'pent' };

export function NeckControls() {
  const r = riff.value;
  const fg = fingering.value;
  const [lo, hi] = rangeOf(r.tuning, r.maxFret);
  const N = fg.options.length;
  const cycle = (d: 1 | -1) => {
    if (N < 1) return;
    const base = fg.choice < 0 ? (d > 0 ? -1 : N) : fg.choice;
    dispatch({ type: 'setRegion', region: { mode: 'auto', choice: (base + d + N) % N } });
  };
  return (
    <div class="ctls" data-testid="neck-controls">
      <Step
        label="Key"
        id="ctl-key"
        value={`${pcName(r.key.tonic)} ${SHORT[r.key.scale] ?? r.key.scale}`}
        onDec={() => shiftKey(-1)}
        onInc={() => shiftKey(1)}
      />
      <Step
        label="Octave"
        id="ctl-oct"
        value="oct"
        decText="−"
        incText="+"
        decOff={!canOctave(r, -1, lo, hi)}
        incOff={!canOctave(r, 1, lo, hi)}
        onDec={() => dispatch({ type: 'transpose', semis: -12 })}
        onInc={() => dispatch({ type: 'transpose', semis: 12 })}
      />
      <Step
        label="Position"
        id="ctl-pos"
        value={N ? `${fg.choice >= 0 ? fg.choice + 1 : '–'}/${N}` : '–'}
        decOff={N < 2}
        incOff={N < 2}
        onDec={() => cycle(-1)}
        onInc={() => cycle(1)}
      />
      <IconButton label={lefty.value ? 'Left-handed' : 'Right-handed'} glyph="⇋" active={lefty.value} onPress={() => setSetting('lefty', !lefty.value)} testId="ctl-lefty" />
    </div>
  );
}
