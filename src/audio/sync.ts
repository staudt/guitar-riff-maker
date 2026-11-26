// Riff -> engine commands, and the transport state the lesson UI drives.
// The engine only hears about changes; it owns all timing.
import { effect, signal } from '@preact/signals';
import type { Riff } from '../model/riff';
import { engineBpm, isFree, totalSteps } from '../model/riff';
import { riff } from '../model/store';
import { expand } from '../music/powerchord';
import { setAuditioner } from '../ui/audition';
import type { Cmd, PNote } from './protocol';
import { initEngine, send } from './host';
import { ensureRunning } from './context';

/** Tempo multiplier for practice (0.25..1.25). */
export const rate = signal(1);
/** Loop range in steps; end <= start = whole riff. */
export const loop = signal<{ start: number; end: number }>({ start: 0, end: 0 });
export const playing = signal(false);
export const metronomeOn = signal(true);

export function riffToNotes(r: Riff): PNote[] {
  return r.notes.map((n, index) => ({
    step: n.step,
    length: n.length,
    midis: expand(n.midi, r.power),
    vel: n.velocity,
    index,
  }));
}

export function riffToCommands(r: Riff, opts: { rate: number; loop: { start: number; end: number }; metronome: boolean }): Cmd[] {
  return [
    { type: 'riff', notes: riffToNotes(r), totalSteps: totalSteps(r) },
    { type: 'tempo', bpm: engineBpm(r), rate: opts.rate },
    { type: 'loop', start: opts.loop.start, end: opts.loop.end },
    { type: 'instrument', kind: r.instrument },
    { type: 'metronome', on: opts.metronome && !isFree(r), gain: 0.6 },
  ];
}

let started: Promise<void> | null = null;

/** Start the engine (must be called from a user gesture the first time) and keep it in sync with the store. */
export function startAudio(): Promise<void> {
  if (started) return ensureRunning().then(() => undefined);
  started = (async () => {
    await ensureRunning();
    await initEngine();
    effect(() => send({ type: 'riff', notes: riffToNotes(riff.value), totalSteps: totalSteps(riff.value) }));
    effect(() => send({ type: 'tempo', bpm: engineBpm(riff.value), rate: rate.value }));
    effect(() => send({ type: 'loop', start: loop.value.start, end: loop.value.end }));
    effect(() => send({ type: 'instrument', kind: riff.value.instrument }));
    // Free timing has no beat: never click.
    effect(() => send({ type: 'metronome', on: metronomeOn.value && !isFree(riff.value), gain: 0.6 }));
  })();
  return started;
}

/** Audition notes from the editor/step mode; lazily starts audio. Power chords expand. */
setAuditioner((midis, vel, seconds) => {
  const r = riff.value;
  const all = r.power === 'off' ? midis : [...new Set(midis.flatMap((m) => expand(m, r.power)))];
  void startAudio().then(() => send({ type: 'audition', midis: all, vel, seconds }));
});

export async function play(from = 0, countIn = true): Promise<void> {
  await startAudio();
  // Count-in beats are 4 steps each: meaningless (40 ms) in free timing.
  send({ type: 'play', from, countInBeats: countIn && !isFree(riff.value) ? 4 : 0 });
  playing.value = true;
}

export function stop(): void {
  if (!started) return;
  send({ type: 'stop' });
  playing.value = false;
}
