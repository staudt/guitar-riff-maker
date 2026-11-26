import './lesson.css';
import { Chip, Segmented, Toggle } from './primitives';
import { loop, metronomeOn, rate } from '../audio/sync';
import { countIn, metronome, setSetting } from '../app/settings';
import { riff, selection, dispatch } from '../model/store';
import { lessonMode, type LessonMode } from '../model/lesson';
import { STEPS_PER_BAR, type Instrument } from '../model/riff';

const RATES = [50, 60, 75, 90, 100];

function selectionRange(): { start: number; end: number } | null {
  const sel = selection.value;
  const ns = riff.value.notes.filter((n) => sel.has(n.id));
  if (!ns.length) return null;
  return {
    start: Math.min(...ns.map((n) => n.step)),
    end: Math.max(...ns.map((n) => n.step + n.length)),
  };
}

export function TransportBar() {
  const r = riff.value;
  const pct = Math.round(rate.value * 100);
  const lp = loop.value;
  const whole = lp.end <= lp.start;
  const sel = selectionRange();
  const bars = Array.from({ length: r.bars }, (_, i) => i + 1);
  const setLoop = (start: number, end: number) => (loop.value = { start, end });

  return (
    <div class="transport" data-testid="transport">
      <div class="transport__row">
        {RATES.map((v) => (
          <Chip key={v} label={`${v}%`} active={pct === v} testId={`tempo-${v}`} onPress={() => (rate.value = v / 100)} />
        ))}
      </div>
      <div class="transport__row transport__tempo">
        <input
          class="transport__slider"
          type="range"
          min={25}
          max={125}
          step={1}
          value={pct}
          aria-label="Tempo"
          data-testid="tempo-slider"
          onInput={(e) => (rate.value = Number((e.currentTarget as HTMLInputElement).value) / 100)}
        />
        <span class="transport__bpm" data-testid="tempo-bpm">
          {Math.round(r.bpm * rate.value)} bpm
        </span>
      </div>
      <div class="transport__row">
        <Chip label="All" active={whole} testId="loop-all" onPress={() => setLoop(0, 0)} />
        {bars.map((n) => (
          <Chip
            key={n}
            label={`Bar ${n}`}
            active={lp.start === (n - 1) * STEPS_PER_BAR && lp.end === n * STEPS_PER_BAR}
            testId={`loop-bar-${n}`}
            onPress={() => setLoop((n - 1) * STEPS_PER_BAR, n * STEPS_PER_BAR)}
          />
        ))}
        {sel && (
          <Chip
            label="Sel"
            active={lp.start === sel.start && lp.end === sel.end}
            testId="loop-sel"
            onPress={() => setLoop(sel.start, sel.end)}
          />
        )}
      </div>
      <div class="transport__row">
        <Toggle label="Count-in" on={countIn.value} testId="toggle-countin" onChange={(v) => setSetting('countIn', v)} />
        <Toggle
          label="Metronome"
          on={metronome.value}
          testId="toggle-metronome"
          onChange={(v) => {
            setSetting('metronome', v);
            metronomeOn.value = v;
          }}
        />
      </div>
      <div class="transport__row">
        <Segmented<LessonMode>
          testId="lesson-mode"
          value={lessonMode.value}
          options={[
            { value: 'play', label: 'Play along' },
            { value: 'step', label: 'Step' },
          ]}
          onChange={(v) => (lessonMode.value = v)}
        />
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
      </div>
    </div>
  );
}
