// Capture state and orchestration: options, free recording (optional count-in + clicks), auto-stop on silence, transcription, hand-off to the riff screen.
import { signal } from '@preact/signals';
import { countIn } from '../app/settings';
import { riffMode, screen } from '../app/nav';
import { loadRiff, riff } from '../model/store';
import { ensureRunning } from '../platform/audio';
import { getLatencyMs, scheduleClick } from '../platform/latency';
import { MAX_RECORD_SECONDS, MicError } from '../platform/recorder';
import { play, stop as stopPlayback } from '../audio/sync';
import { startLive, type LiveSession } from './live';
import { transcribe } from './transcribe';
import { toRiff } from './toRiff';
import type { CaptureSource, RawNote, Transcription } from './types';

export type Phase = 'idle' | 'countin' | 'recording' | 'analyzing' | 'done' | 'error';
export type CaptureOptions = { source: 'whistle' | 'voice'; metronome: boolean; bpm: number };

const KEY = 'riffmaker.capture';
const DEFAULTS: CaptureOptions = { source: 'whistle', metronome: false, bpm: 90 };
/** Stop on its own after this much silence once a note was heard. */
export const SILENCE_STOP_S = 2;
const MIN_VOICED_FRAMES = 5;
const MAX_TAKE_S = MAX_RECORD_SECONDS;

function loadOpts(): CaptureOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CaptureOptions> | null;
    if (!o) return { ...DEFAULTS };
    return {
      source: o.source === 'voice' || o.source === 'whistle' ? o.source : DEFAULTS.source,
      metronome: o.metronome === true,
      bpm: typeof o.bpm === 'number' && o.bpm >= 40 && o.bpm <= 220 ? Math.round(o.bpm) : DEFAULTS.bpm,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export const options = signal<CaptureOptions>(loadOpts());
export function setOption<K extends keyof CaptureOptions>(k: K, v: CaptureOptions[K]): void {
  options.value = { ...options.value, [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(options.value)); } catch { /* ignore */ }
}

export const phase = signal<Phase>('idle');
/** 1..4 during the count-in, else 0. */
export const beat = signal(0);
export const progress = signal(0);
export const error = signal('');
/** Smoothed mic level 0..1. */
export const level = signal(0);

/** Mutable run info read by the canvas from rAF; never reactive. */
export type Run = {
  live: LiveSession;
  ctx: AudioContext;
  clicks: { stop(): void }[];
  metronome: boolean;
  /** Seconds per beat (metronome mode), else 0. */
  beatS: number;
  /** AudioContext time of "time zero": first bar after the count-in (metronome) or the first sample (free). */
  tBar1: number;
  /** Seconds to subtract from recorded-audio time to get transcription time. */
  offset: number;
  source: CaptureOptions['source'];
  finishing: boolean;
  scanned: number;
  voiced: number;
  /** Frame time (s) of the last voiced frame. */
  lastVoiced: number;
};
let run: Run | null = null;
let raf = 0;
let timer = 0;
export const getRun = (): Run | null => run;

const micMessage = (e: unknown): string =>
  e instanceof MicError
    ? e.reason === 'denied'
      ? 'Microphone access is blocked. Allow it in the browser site settings, then try again.'
      : e.reason === 'nomic'
        ? 'No microphone found. Plug one in or close other apps using it.'
        : e.message
    : e instanceof Error ? e.message : 'Could not start the microphone.';

function tick(): void {
  const r = run;
  if (!r || r.finishing) return;
  raf = requestAnimationFrame(tick);
  const now = r.ctx.currentTime;
  const lvl = r.live.level();
  if (Math.abs(lvl - level.peek()) > 0.02) level.value = lvl;
  const rel = now - r.tBar1;
  if (rel < 0) {
    if (phase.peek() !== 'countin') phase.value = 'countin';
    const b = Math.max(1, Math.min(4, 4 + Math.floor(rel / r.beatS) + 1));
    if (beat.peek() !== b) beat.value = b;
    return;
  }
  if (phase.peek() !== 'recording') phase.value = 'recording';
  if (beat.peek() !== 0) beat.value = 0;
  const fr = r.live.frames;
  const t0 = r.tBar1 - r.live.startTime;
  for (; r.scanned < fr.length; r.scanned++) {
    const f = fr[r.scanned]!;
    if (f.hz > 0 && f.t >= t0) { r.voiced++; r.lastVoiced = f.t; }
  }
  if (r.voiced >= MIN_VOICED_FRAMES && now - r.live.startTime - r.lastVoiced >= SILENCE_STOP_S) void finish(false);
}

/** Call from the REC click handler: audio resume and getUserMedia must start inside the gesture. */
export async function start(): Promise<void> {
  if (phase.value !== 'idle' && phase.value !== 'error' && phase.value !== 'done') return;
  error.value = '';
  progress.value = 0;
  beat.value = 0;
  stopPlayback();
  const o = options.value;
  try {
    const ctx = await ensureRunning();
    const live = await startLive(o.source as CaptureSource, { onLimit: () => void finish(false) });
    const clicks: { stop(): void }[] = [];
    let tBar1 = live.startTime;
    let beatS = 0;
    let offset = 0;
    if (o.metronome) {
      beatS = 60 / o.bpm;
      const barDur = beatS * 4;
      const countBars = countIn.value ? 1 : 0;
      const clicksStart = ctx.currentTime + 0.25;
      tBar1 = clicksStart + countBars * barDur;
      offset = tBar1 - live.startTime + getLatencyMs() / 1000;
      // Clicks for the whole take (the recorder caps it at 30 s); stop() cancels the rest.
      const total = countBars * 4 + Math.ceil((MAX_TAKE_S + 1) / beatS);
      for (let k = 0; k < total; k++) clicks.push(scheduleClick(ctx, clicksStart + k * beatS, k % 4 === 0));
    }
    run = { live, ctx, clicks, metronome: o.metronome, beatS, tBar1, offset, source: o.source, finishing: false, scanned: 0, voiced: 0, lastVoiced: 0 };
    phase.value = o.metronome && tBar1 > ctx.currentTime ? 'countin' : 'recording';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    // Fallback for backgrounded tabs where rAF pauses (and for a recorder that never reports its limit).
    timer = window.setTimeout(() => void finish(false), (tBar1 - ctx.currentTime + MAX_TAKE_S + 1) * 1000);
  } catch (e) {
    error.value = micMessage(e);
    phase.value = 'error';
  }
}

/** Ends the take early or on schedule and analyzes what was recorded. */
export function stop(): Promise<void> { return finish(false); }
export function cancel(): void { void finish(true); }

async function finish(abort: boolean): Promise<void> {
  const r = run;
  if (!r || r.finishing) return;
  r.finishing = true;
  cancelAnimationFrame(raf);
  window.clearTimeout(timer);
  r.clicks.forEach((c) => c.stop());
  level.value = 0;
  beat.value = 0;
  if (abort || r.ctx.currentTime - r.tBar1 < 0.3) {
    r.live.cancel();
    run = null;
    phase.value = 'idle';
    return;
  }
  phase.value = 'analyzing';
  progress.value = 0;
  try {
    const audio = await r.live.stop();
    const tr = await transcribe(audio.l, audio.rate, r.source, { offset: r.offset, onProgress: (p) => { progress.value = p; } });
    handOff(tr, r.metronome ? options.value.bpm : undefined, true);
  } catch (e) {
    error.value = micMessage(e);
    phase.value = 'error';
  } finally {
    run = null;
  }
}

/** Builds the riff from a transcription, opens it in the editor and (optionally) plays it back. Shared by the test hook. */
function handOff(tr: Transcription, hintBpm: number | undefined, autoplay: boolean): void {
  if (tr.notes.length === 0) {
    error.value = 'No notes heard. Whistle or hum a little louder and closer to the microphone, then try again.';
    phase.value = 'error';
    return;
  }
  const cur = riff.peek();
  const built = toRiff(tr, {
    hintBpm, power: cur.power, tuningLow: cur.tuning.strings[0] ?? 40,
    base: { tuning: cur.tuning, maxFret: cur.maxFret, instrument: cur.instrument },
  });
  loadRiff(built);
  riffMode.value = 'edit';
  screen.value = 'riff';
  phase.value = 'idle';
  if (autoplay) void play(0, false);
}

/** Resets transient state when the screen is left. */
export function leave(): void {
  if (run) cancel();
  if (phase.value === 'error' || phase.value === 'done') phase.value = 'idle';
  error.value = '';
}

// Test builds: skip the mic and feed notes (seconds from the start) straight into the riff builder.
if (import.meta.env.MODE === 'test' && typeof window !== 'undefined') {
  (window as unknown as { __capture: unknown }).__capture = {
    phase: () => phase.value,
    options: () => options.value,
    place(notes: RawNote[], bpm?: number) {
      handOff({ source: 'whistle', model: false, notes }, bpm, false);
    },
  };
}
