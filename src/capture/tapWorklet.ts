// Mic tap for the live pitch tracker: copies input into a preallocated chunk and posts it when full.
// AUDIO THREAD RULES: no allocations in process() except the throttled chunk post (one per CHUNK
// frames, about every 43 ms at 48 kHz); no closures created per block; nothing else crosses the port
// except one 'start' message that stamps the first frame (so the UI can map audio time to clock time).

export {}; // module scope: the worklet globals below must not collide with other worklet files

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

const CHUNK = 2048;

class TapProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private fill = 0;
  private started = false;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (!this.started) {
      this.started = true;
      this.port.postMessage({ type: 'start', frame: currentFrame, rate: sampleRate });
    }
    let i = 0;
    const n = ch.length;
    while (i < n) {
      const take = Math.min(n - i, CHUNK - this.fill);
      this.buf.set(ch.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === CHUNK) {
        this.port.postMessage({ type: 'chunk', data: this.buf }); // structured clone; buf is reused
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('riffmaker-tap', TapProcessor);
