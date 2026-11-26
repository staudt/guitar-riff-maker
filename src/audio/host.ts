// Main-thread side of the engine: owns the worklet node, queues commands sent before init.
import workletUrl from './worklet.ts?worker&url';
import type { Cmd, Evt } from './protocol';
import { ensureRunning, getAudioContext } from './context';

let node: AudioWorkletNode | null = null;
let starting: Promise<void> | null = null;
const queue: Cmd[] = [];
const listeners = new Set<(e: Evt) => void>();

/** Creates the worklet node (call from a user gesture the first time). Safe to call repeatedly. */
export function initEngine(): Promise<void> {
  if (node) return Promise.resolve();
  starting ??= (async () => {
    const ctx = await ensureRunning();
    await ctx.audioWorklet.addModule(workletUrl);
    const n = new AudioWorkletNode(ctx, 'riff-engine', { numberOfInputs: 0, outputChannelCount: [2] });
    n.port.onmessage = (e: MessageEvent<Evt[] | Evt>) => {
      const data = e.data;
      if (Array.isArray(data)) for (const ev of data) for (const l of listeners) l(ev);
      else for (const l of listeners) l(data);
    };
    n.connect(ctx.destination);
    node = n;
    for (const c of queue.splice(0)) n.port.postMessage(c);
  })().catch((err) => {
    starting = null;
    throw err;
  });
  return starting;
}

/** Sends a command; commands sent before initEngine() resolves are delivered in order afterwards. */
export function send(cmd: Cmd): void {
  if (node) node.port.postMessage(cmd);
  else queue.push(cmd);
}

export function onEvent(cb: (e: Evt) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Seconds between a frame being rendered and being heard. */
export function outputLatency(): number {
  const ctx = getAudioContext();
  return ctx.outputLatency ?? ctx.baseLatency ?? 0;
}

/** AudioContext time (same clock as event times). */
export function contextTime(): number {
  return getAudioContext().currentTime;
}
