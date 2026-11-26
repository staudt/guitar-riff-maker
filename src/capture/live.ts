// Live capture plumbing: mic -> (full-rate recorder for the final transcription) + (tap worklet ->
// tracker Web Worker -> PitchFrames for the live readout). One getUserMedia stream feeds both.
import tapUrl from './tapWorklet.ts?worker&url';
import TrackerWorker from './trackerWorker.ts?worker';
import { startRecording } from '../platform/recorder';
import { getAudioContext } from '../platform/audio';
import type { TrackerIn, TrackerOut } from './trackerWorker';
import type { CaptureSource, PitchFrame } from './types';

export type LiveSession = {
  /** Live frames so far (t = seconds from the first captured sample). Grows; read from rAF, never reactive. */
  readonly frames: PitchFrame[];
  /** AudioContext time of the first captured sample. Audio index i happened at startTime + i / rate. */
  readonly startTime: number;
  /** Smoothed peak level 0..1 (cheap; rAF). */
  level(): number;
  /** Stops, releases the mic and resolves with the full-rate recording. */
  stop(): Promise<{ l: Float32Array; rate: number }>;
  cancel(): void;
};

let tapLoaded = false;

/**
 * Opens the mic and starts recording (and tracking unless `track` is false). Call from a user gesture.
 * Rejects with MicError when the mic is denied or missing.
 */
export async function startLive(source: CaptureSource, opts: { track?: boolean; onLimit?: () => void } = {}): Promise<LiveSession> {
  const track = opts.track ?? true;
  const frames: PitchFrame[] = [];
  const w: { worker: Worker | null } = { worker: null };
  let startFrame: number | null = null;
  let startResolve: (() => void) | null = null;
  const started = new Promise<void>((r) => { startResolve = r; });

  const rec = await startRecording(opts.onLimit, {
    tap: async (ctx, src) => {
      if (!tapLoaded) {
        await ctx.audioWorklet.addModule(tapUrl);
        tapLoaded = true;
      }
      const node = new AudioWorkletNode(ctx, 'riffmaker-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      if (track) {
        const worker = new TrackerWorker();
        w.worker = worker;
        worker.onmessage = (e: MessageEvent<TrackerOut>) => {
          const d = e.data.data;
          for (let i = 0; i < d.length; i += 4) frames.push({ t: d[i]!, hz: d[i + 1]!, clarity: d[i + 2]!, rms: d[i + 3]! });
        };
        worker.postMessage({ type: 'init', rate: ctx.sampleRate, source } satisfies TrackerIn);
      }
      node.port.onmessage = (e: MessageEvent<{ type: string; frame?: number; data?: Float32Array }>) => {
        if (e.data.type === 'start') {
          startFrame = e.data.frame ?? 0;
          startResolve?.();
        } else if (e.data.type === 'chunk' && e.data.data && w.worker) {
          const d = e.data.data;
          w.worker.postMessage({ type: 'audio', data: d } satisfies TrackerIn, [d.buffer]);
        }
      };
      return () => {
        try { src.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* already gone */ }
        w.worker?.terminate();
        w.worker = null;
      };
    },
  });

  // The first block stamps the clock; if it never arrives (muted input graph), fall back to "now".
  const ctxNow = getAudioContext();
  await Promise.race([started, new Promise<void>((r) => setTimeout(r, 1500))]);
  const startTime = startFrame !== null ? startFrame / ctxNow.sampleRate : ctxNow.currentTime;

  return {
    frames,
    startTime,
    level: () => rec.level(),
    stop: async () => {
      const r = await rec.stop();
      w.worker?.terminate();
      w.worker = null;
      return r;
    },
    cancel: () => {
      rec.cancel();
      w.worker?.terminate();
      w.worker = null;
    },
  };
}
