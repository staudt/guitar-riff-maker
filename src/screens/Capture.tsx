// Record-a-riff screen: tap REC, whistle or hum freely, stop (or fall silent) and land in the editor with the riff playing.
import { useEffect, useState } from 'preact/hooks';
import { screen } from '../app/nav';
import { MicError } from '../platform/recorder';
import { calibrateLatency, getLatencyMs } from '../platform/latency';
import { SILENCE_STOP_S, beat, cancel, error, leave, level, options, phase, progress, setOption, start, stop } from '../capture/session';
import { PitchTrace } from '../ui/PitchTrace';
import { Segmented, Stepper, StompButton, Toggle } from '../ui/primitives';
import '../ui/capture.css';

const clampBpm = (n: number) => Math.max(40, Math.min(220, n));

function statusText(): string {
  const p = phase.value;
  if (error.value) return error.value;
  if (p === 'countin') return 'Get ready…';
  if (p === 'recording') return `Listening… stops after ${SILENCE_STOP_S} s of silence`;
  if (p === 'analyzing') return progress.value < 0.05 ? 'Analyzing… loading the note model' : `Analyzing… ${Math.round(progress.value * 100)}%`;
  return 'Tap REC and whistle your riff';
}

export function CaptureScreen() {
  const [lat, setLat] = useState(getLatencyMs());
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState('');
  useEffect(() => () => leave(), []);

  const p = phase.value;
  const o = options.value;
  const live = p === 'countin' || p === 'recording';
  const busy = live || p === 'analyzing';

  const calibrate = async () => {
    setCalBusy(true);
    setCalMsg('');
    try {
      const v = await calibrateLatency();
      if (v === null) setCalMsg('Could not hear the clicks. Volume up, headphones off.');
      setLat(getLatencyMs());
    } catch (e) {
      setCalMsg(e instanceof MicError ? e.message : 'Calibration failed.');
    }
    setCalBusy(false);
  };

  return (
    <main class="capture-screen" data-testid="capture-screen" data-phase={p}>
      <header class="capture-head">
        <button type="button" class="capture-back" aria-label="Back to riff" disabled={p === 'analyzing'} onClick={() => { cancel(); screen.value = 'riff'; }}>
          ◀
        </button>
        <h1>Record a riff</h1>
      </header>

      <div class="capture-stage">
        <PitchTrace />
        {p === 'countin' && beat.value > 0 && <div class="capture-count" data-testid="capture-count" aria-hidden="true">{beat.value}</div>}
      </div>

      <div class="capture-meter" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, level.value) * 100)}%` }} /></div>

      <p class="capture-status" data-testid="capture-status" data-error={error.value ? '' : undefined} role={error.value ? 'alert' : 'status'}>
        {statusText()}
      </p>

      <div class="capture-rec">
        <StompButton
          testId="capture-rec"
          tone="rec"
          icon={live ? 'stop' : 'rec'}
          label={live ? 'STOP' : 'REC'}
          active={live}
          onPress={() => { if (live) void stop(); else if (!busy) void start(); }}
        />
      </div>

      <div class="capture-opts">
        <Segmented testId="capture-source" options={[{ value: 'whistle', label: 'Whistle' }, { value: 'voice', label: 'Hum' }]} value={o.source} onChange={(v) => !busy && setOption('source', v)} />
        <Toggle testId="capture-metronome" label="Metronome" on={o.metronome} onChange={(v) => !busy && setOption('metronome', v)} />
      </div>

      {o.metronome && (
        <div class="capture-metro">
          <Stepper testId="capture-bpm" label="Tempo" value={`${o.bpm} bpm`} decDisabled={busy} incDisabled={busy} onDec={() => setOption('bpm', clampBpm(o.bpm - 2))} onInc={() => setOption('bpm', clampBpm(o.bpm + 2))} />
          <button type="button" class="capture-cal__btn" data-testid="capture-calibrate" disabled={busy || calBusy} onClick={() => void calibrate()}>
            {calBusy ? 'Listening…' : 'Calibrate'}
          </button>
          <span class="capture-cal__ms" data-testid="capture-latency">{lat > 0 ? `${lat} ms` : 'not set'}</span>
          {calMsg && <span class="capture-cal__msg" role="alert">{calMsg}</span>}
        </div>
      )}
    </main>
  );
}
