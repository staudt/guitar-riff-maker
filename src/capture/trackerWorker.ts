// Web Worker: runs the streaming pitch tracker off the UI thread. Receives raw mic chunks from the
// main thread (relayed from the tap worklet), posts packed frames [t, hz, clarity, rms] * n back.
import { LiveTracker } from './stream';
import type { CaptureSource } from './types';

export type TrackerIn = { type: 'init'; rate: number; source: CaptureSource } | { type: 'audio'; data: Float32Array };
export type TrackerOut = { type: 'frames'; data: Float32Array };

let tracker: LiveTracker | null = null;
const ctx = self as unknown as { postMessage(m: TrackerOut, transfer: Transferable[]): void; onmessage: ((e: MessageEvent<TrackerIn>) => void) | null };

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    tracker = new LiveTracker(m.rate, m.source);
  } else if (tracker) {
    const frames = tracker.push(m.data);
    if (!frames.length) return;
    const out = new Float32Array(frames.length * 4);
    frames.forEach((f, i) => { out[i * 4] = f.t; out[i * 4 + 1] = f.hz; out[i * 4 + 2] = f.clarity; out[i * 4 + 3] = f.rms; });
    ctx.postMessage({ type: 'frames', data: out }, [out.buffer]);
  }
};
