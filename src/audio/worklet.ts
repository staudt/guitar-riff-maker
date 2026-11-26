// AudioWorklet entry: hosts the whole engine. AUDIO THREAD: no allocations in process() beyond
// the per-event objects built when events exist; no closures per block.
import { Engine } from './core';
import type { Cmd, Evt } from './protocol';

// Minimal typings for the AudioWorkletGlobalScope (not in lib.dom).
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

export type EngineProcessorOptions = { commands?: Cmd[] };

class EngineProcessor extends AudioWorkletProcessor {
  private readonly engine = new Engine(sampleRate);
  private batch: Evt[] = [];
  private readonly collect = (e: Evt): void => {
    this.batch.push(e);
  };

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = (e: MessageEvent<Cmd>) => this.engine.command(e.data);
    // Initial state can be passed at construction (offline render tests: port messages may arrive late).
    const init = (options?.processorOptions as EngineProcessorOptions | undefined)?.commands;
    if (init) for (const c of init) this.engine.command(c);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const l = out[0]!;
    const r = out[1] ?? l;
    this.engine.process(l, r, currentFrame);
    this.engine.drainEvents(this.collect);
    if (this.batch.length > 0) {
      this.port.postMessage(this.batch);
      this.batch = [];
    }
    return true;
  }
}

registerProcessor('riff-engine', EngineProcessor);
