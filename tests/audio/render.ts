// Offline render helper: drives the Engine in 128-frame blocks like the worklet would.
import { Engine } from '../../src/audio/core';
import type { Cmd, Evt } from '../../src/audio/protocol';

export const SR = 48000;

export type Render = { l: Float32Array; r: Float32Array; events: Evt[]; engine: Engine };

export function render(cmds: Cmd[], seconds: number, opts: { at?: { time: number; cmd: Cmd }[]; frame0?: number } = {}): Render {
  const engine = new Engine(SR);
  const events: Evt[] = [];
  const total = Math.round(seconds * SR);
  const l = new Float32Array(total);
  const r = new Float32Array(total);
  const bl = new Float32Array(128);
  const br = new Float32Array(128);
  for (const c of cmds) engine.command(c);
  const pending = [...(opts.at ?? [])].sort((a, b) => a.time - b.time);
  const base = opts.frame0 ?? 0;
  for (let off = 0; off < total; off += 128) {
    while (pending.length && pending[0]!.time * SR < off + 128) engine.command(pending.shift()!.cmd);
    engine.process(bl, br, base + off);
    engine.drainEvents((e) => events.push(e));
    const n = Math.min(128, total - off);
    l.set(bl.subarray(0, n), off);
    r.set(br.subarray(0, n), off);
  }
  return { l, r, events, engine };
}
