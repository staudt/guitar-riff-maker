// Record-a-riff screen: pick bars / source / tempo, tap REC, whistle or hum, land in the editor.
import { useEffect, useState } from 'preact/hooks';
import { screen } from '../app/nav';
import { MicError } from '../platform/recorder';
import { calibrateLatency, getLatencyMs } from '../platform/latency';
import { beat, bar, cancel, error, leave, level, options, phase, progress, setOption, start, stop } from '../capture/session';
import { PitchTrace } from '../ui/PitchTrace';
import { Segmented, Stepper, StompButton } from '../ui/primitives';
import '../ui/capture.css';

const clampBpm = (n: number) => Math.max(40, Math.min(220, n));

function statusText(): string {
  const p = phase.value;
  const o = options.value;
  if (error.value) return error.value;
  if (p === 'countin') return 'Get ready…';
  if (p === 'recording') return `Recording… bar ${Math.max(1, bar.value)}/${o.bars}`;
  if (p === 'analyzing') return progress.value < 0.05 ? 'Analyzing… loading the note model' : `Analyzing… ${Math.round(progress.value * 100)}%`;
  return 'Ready. Tap REC when you are.';
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

      <div class="capture-opts">
        <Segmented testId="capture-bars" options={[{ value: 1, label: '1 bar' }, { value: 2, label: '2' }, { value: 4, label: '4' }]} value={o.bars} onChange={(v) => !busy && setOption('bars', v as 1 | 2 | 4)} />
        <Segmented testId="capture-source" options={[{ value: 'whistle', label: 'Whistle' }, { value: 'voice', label: 'Hum' }]} value={o.source} onChange={(v) => !busy && setOption('source', v)} />
        <Stepper testId="capture-bpm" label="Tempo" value={`${o.bpm} bpm`} decDisabled={busy} incDisabled={busy} onDec={() => setOption('bpm', clampBpm(o.bpm - 2))} onInc={() => setOption('bpm', clampBpm(o.bpm + 2))} />
        <Segmented testId="capture-grid" options={[{ value: 8, label: '1/8' }, { value: 16, label: '1/16' }]} value={o.grid} onChange={(v) => !busy && setOption('grid', v)} />
      </div>

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

      <p class="capture-tip">Use headphones so the click doesn't leak into the mic. Whistle or sing "da da" - clear note starts help.</p>

      <div class="capture-cal">
        <button type="button" class="capture-cal__btn" data-testid="capture-calibrate" disabled={busy || calBusy} onClick={() => void calibrate()}>
          {calBusy ? 'Listening…' : 'Calibrate latency'}
        </button>
        <span class="capture-cal__ms" data-testid="capture-latency">{lat > 0 ? `${lat} ms` : 'not set'}</span>
        {calMsg && <span class="capture-cal__msg" role="alert">{calMsg}</span>}
      </div>
    </main>
  );
}
