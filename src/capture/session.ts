// Capture state and orchestration: options, count-in + clicks, live recording, transcription, hand-off to the riff screen.
import { signal } from '@preact/signals';
import { countIn, metronome } from '../app/settings';
import { riffMode, screen } from '../app/nav';
import { loadRiff, riff } from '../model/store';
import type { GridSize } from '../model/riff';
import { ensureRunning } from '../platform/audio';
import { getLatencyMs, scheduleClick } from '../platform/latency';
import { MicError } from '../platform/recorder';
import { stop as stopPlayback } from '../audio/sync';
import { startLive, type LiveSession } from './live';
import { transcribe } from './transcribe';
import { toRiff } from './toRiff';
import type { CaptureSource, RawNote, Transcription } from './types';

export type Phase = 'idle' | 'countin' | 'recording' | 'analyzing' | 'done' | 'error';
export type CaptureOptions = { bars: 1 | 2 | 4; source: 'whistle' | 'voice'; bpm: number; grid: GridSize };

const KEY = 'riffmaker.capture';
const DEFAULTS: CaptureOptions = { bars: 2, source: 'whistle', bpm: 90, grid: 16 };

function loadOpts(): CaptureOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CaptureOptions> | null;
    if (!o) return { ...DEFAULTS };
    return {
      bars: o.bars === 1 || o.bars === 2 || o.bars === 4 ? o.bars : DEFAULTS.bars,
      source: o.source === 'voice' || o.source === 'whistle' ? o.source : DEFAULTS.source,
      bpm: typeof o.bpm === 'number' && o.bpm >= 40 && o.bpm <= 220 ? Math.round(o.bpm) : DEFAULTS.bpm,
      grid: o.grid === 8 || o.grid === 16 ? o.grid : DEFAULTS.grid,
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
/** 1-based bar being recorded (0 outside recording). */
export const bar = signal(0);
export const progress = signal(0);
export const error = signal('');
/** Smoothed mic level 0..1. */
export const level = signal(0);

/** Mutable run info read by the canvas from rAF; never reactive. */
export type Run = {
  live: LiveSession;
  ctx: AudioContext;
  clicks: { stop(): void }[];
  tBar1: number;
  barDur: number;
  bars: number;
  /** Seconds to subtract from audio time to get bar time. */
  offset: number;
  opts: CaptureOptions;
  finishing: boolean;
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
  const rel = now - r.tBar1;
  const lvl = r.live.level();
  if (Math.abs(lvl - level.peek()) > 0.02) level.value = lvl;
  if (rel < 0) {
    if (phase.peek() !== 'countin') phase.value = 'countin';
    const b = Math.max(1, Math.min(4, 4 + Math.floor(rel / (r.barDur / 4)) + 1));
    if (beat.peek() !== b) beat.value = b;
  } else {
    if (phase.peek() !== 'recording') phase.value = 'recording';
    if (beat.peek() !== 0) beat.value = 0;
    const b = Math.min(r.bars, Math.floor(rel / r.barDur) + 1);
    if (bar.peek() !== b) bar.value = b;
    if (rel >= r.bars * r.barDur + getLatencyMs() / 1000 + 0.25) void finish(false);
  }
}

/** Call from the REC click handler: audio resume and getUserMedia must start inside the gesture. */
export async function start(): Promise<void> {
  if (phase.value !== 'idle' && phase.value !== 'error' && phase.value !== 'done') return;
  error.value = '';
  progress.value = 0;
  beat.value = 0;
  bar.value = 0;
  stopPlayback();
  const o = options.value;
  try {
    const ctx = await ensureRunning();
    const live = await startLive(o.source as CaptureSource, { onLimit: () => void finish(false) });
    const beatS = 60 / o.bpm;
    const barDur = beatS * 4;
    const lat = getLatencyMs() / 1000;
    const countBars = countIn.value ? 1 : 0;
    const clicksStart = ctx.currentTime + 0.25;
    const tBar1 = clicksStart + countBars * barDur;
    const clicks: { stop(): void }[] = [];
    for (let k = 0; k < (countBars + o.bars) * 4; k++) {
      const inCount = k < countBars * 4;
      if (inCount || metronome.value) clicks.push(scheduleClick(ctx, clicksStart + k * beatS, k % 4 === 0));
    }
    run = { live, ctx, clicks, tBar1, barDur, bars: o.bars, offset: tBar1 - live.startTime + lat, opts: { ...o }, finishing: false };
    phase.value = countBars > 0 ? 'countin' : 'recording';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    // Fallback for backgrounded tabs where rAF pauses.
    timer = window.setTimeout(() => void finish(false), (tBar1 + o.bars * barDur + lat + 0.6 - ctx.currentTime) * 1000);
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
  const rel = r.ctx.currentTime - r.tBar1;
  if (abort || rel < 0.3) {
    r.live.cancel();
    run = null;
    phase.value = 'idle';
    bar.value = 0;
    return;
  }
  phase.value = 'analyzing';
  progress.value = 0;
  try {
    const audio = await r.live.stop();
    const tr = await transcribe(audio.l, audio.rate, r.opts.source, { offset: r.offset, onProgress: (p) => { progress.value = p; } });
    handOff(tr, r.opts, Math.min(r.opts.bars * r.barDur, rel));
  } catch (e) {
    error.value = micMessage(e);
    phase.value = 'error';
  } finally {
    run = null;
  }
}

/** Builds the riff from a transcription and opens it in the editor. Shared by the test hook. */
function handOff(tr: Transcription, o: CaptureOptions, maxT = Infinity): void {
  const notes: RawNote[] = tr.notes.filter((n) => n.start < maxT + 0.05);
  if (notes.length === 0) {
    error.value = 'No notes heard. Whistle or hum a little louder and closer to the microphone, then try again.';
    phase.value = 'error';
    return;
  }
  const cur = riff.peek();
  const built = toRiff({ ...tr, notes }, {
    bpm: o.bpm, bars: o.bars, grid: o.grid, power: cur.power, tuningLow: cur.tuning.strings[0] ?? 40,
    base: { tuning: cur.tuning, maxFret: cur.maxFret, instrument: cur.instrument },
  });
  loadRiff(built);
  phase.value = 'done';
  riffMode.value = 'edit';
  screen.value = 'riff';
  phase.value = 'idle';
}

/** Resets transient state when the screen is left. */
export function leave(): void {
  if (run) cancel();
  if (phase.value === 'error' || phase.value === 'done') phase.value = 'idle';
  error.value = '';
}

// Test builds: skip the mic and feed notes (seconds from bar 1) straight into the riff builder.
if (import.meta.env.MODE === 'test' && typeof window !== 'undefined') {
  (window as unknown as { __capture: unknown }).__capture = {
    phase: () => phase.value,
    options: () => options.value,
    place(notes: RawNote[], bars: 1 | 2 | 4 = 2, bpm = 90) {
      handOff({ source: 'whistle', model: false, notes }, { ...options.value, bars, bpm });
    },
  };
}
