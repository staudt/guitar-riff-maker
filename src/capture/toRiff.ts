// Transcription -> Riff. Free timing (default): notes keep their real timing in 10 ms ticks and the
// pitch line they were cut from is stored with the riff. Grid timing (metronome): quantize to a bpm grid.
import { autoQuantize } from './tempo';
import { detectKey } from './key';
import { cleanLine, segmentNotes } from './notes';
import type { PitchFrame, RawNote, Transcription } from './types';
import { MAX_BARS, MAX_SPAN, TICK_MS, newId, newRiff, type Bars, type PowerMode, type Riff, type RiffNote, type Trace } from '../model/riff';

export type ToRiffOpts = {
  /** Known tempo (metronome mode); otherwise it is estimated from the notes. */
  hintBpm?: number;
  power: PowerMode;
  /** Lowest open string, MIDI (40 in standard tuning). */
  tuningLow: number;
  base?: Partial<Riff>;
};

/** Highest pitch we try to keep notes under (about fret 22 of the high e string). */
export const MAX_MIDI = 86;

const TICK = TICK_MS / 1000;
/** Silence kept before the first sound and after the last one, seconds / ticks. */
const LEAD_S = 0.05;
const TAIL_TICKS = 50;

export function defaultName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Riff ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Whole-octave shift that brings the melody to the guitar: center 55 (45 with power chords), never below the low string. */
export function fitShift(midis: number[], power: PowerMode, tuningLow: number): number {
  if (!midis.length) return 0;
  const center = power === 'off' ? 55 : 45;
  const sorted = midis.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  let shift = Math.round((center - med) / 12) * 12;
  const lo = () => sorted[0]! + shift;
  const hi = () => sorted[sorted.length - 1]! + shift;
  while (lo() < tuningLow) shift += 12;
  // Come down only if the melody still fits above the low string afterwards.
  while (hi() > MAX_MIDI && lo() - 12 >= tuningLow) shift -= 12;
  return shift;
}

/** Pitch line of a take: cleaned frames as {hop, start, midi}, trimmed to the sounding part. start = time of point 0 (frame centre). */
export function frameTrace(frames: PitchFrame[]): Trace | null {
  if (frames.length < 2) return null;
  const line = cleanLine(frames);
  let a = line.midi.findIndex((m) => !Number.isNaN(m));
  if (a < 0) return null;
  let b = line.midi.length - 1;
  while (b > a && Number.isNaN(line.midi[b]!)) b--;
  const pad = Math.round(LEAD_S / line.dt);
  a = Math.max(0, a - pad);
  b = Math.min(line.midi.length - 1, b + pad);
  return { hop: line.dt, start: frames[a]!.t, midi: line.midi.slice(a, b + 1).map((m) => (Number.isNaN(m) ? null : m)) };
}

const shiftTrace = (t: Trace, dt: number, semis: number): Trace => ({ hop: t.hop, start: t.start - dt, midi: t.midi.map((m) => (m === null ? null : m + semis)) });

function baseFields(opts: ToRiffOpts): Partial<Riff> {
  return { name: defaultName(), ...opts.base, power: opts.power };
}

/** Free timing: notes cut from the very pitch line the user watched, timing kept in ticks. */
export function toRiffFree(frames: PitchFrame[], opts: ToRiffOpts, notesIn?: RawNote[]): Riff {
  const trace0 = frameTrace(frames);
  const notes0 = notesIn ?? segmentNotes(frames);
  return buildFree(notes0, trace0, opts);
}

/** Free timing from already detected notes (test hook, no trace unless given). */
export function buildFree(notes0: RawNote[], trace0: Trace | null, opts: ToRiffOpts): Riff {
  const first = notes0.length ? notes0[0]!.start : 0;
  // The trace already carries its own lead-in (50 ms before the first sound).
  const t0 = trace0 ? Math.min(trace0.start, first - LEAD_S) : first - LEAD_S;
  const shift = fitShift(notes0.map((n) => Math.round(n.midi)), opts.power, opts.tuningLow);
  const max = MAX_SPAN - TAIL_TICKS;
  const out: RiffNote[] = [];
  for (const n of notes0) {
    const step = Math.max(0, Math.round((n.start - t0) / TICK));
    if (step >= max) break;
    const midi = Math.round(n.midi) + shift;
    const length = Math.max(3, Math.min(max - step, Math.round((n.end - n.start) / TICK)));
    out.push({ id: newId(), step, length, midi, velocity: Math.max(1, Math.min(127, Math.round(n.velocity))), src: { step, length, midi } });
  }
  // Monophonic: a note never runs into the next one.
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!;
    const room = out[i + 1]!.step - a.step;
    if (a.length > room) { a.length = Math.max(1, room); a.src = { ...a.src!, length: a.length }; }
  }
  const last = out[out.length - 1];
  const span = Math.min(MAX_SPAN, (last ? last.step + last.length : 0) + TAIL_TICKS);
  const key = out.length ? detectKey(out) : { tonic: 9 as const, scale: 'minor' as const };
  const raw: RawNote[] = notes0.map((n) => ({ ...n, start: n.start - t0, end: n.end - t0, midi: n.midi + shift }));
  const auto = notes0.length ? autoQuantize(notes0, { maxBars: MAX_BARS }) : null;
  const bpm = Math.round(opts.hintBpm ?? auto?.bpm ?? 100);
  const bars = Math.max(1, Math.min(MAX_BARS, Math.ceil((span * TICK) / ((60 / bpm) * 4)))) as Bars;
  return newRiff({
    ...baseFields(opts),
    timing: 'free',
    bpm,
    bars,
    span,
    key: { tonic: key.tonic, scale: key.scale },
    notes: out,
    capture: { raw, bpm },
    ...(trace0 ? { trace: shiftTrace(trace0, t0, shift) } : {}),
  });
}

/** Grid timing (metronome mode, or re-quantizing): notes snapped to a bpm grid; the trace (if any) is kept in riff seconds. */
export function toRiff(trans: Transcription, opts: ToRiffOpts): Riff {
  const { hintBpm, power, tuningLow } = opts;
  const auto = autoQuantize(trans.notes, { hintBpm, maxBars: MAX_BARS });
  const grid0 = auto.notes;
  const shift = fitShift(grid0.map((n) => n.midi), power, tuningLow);
  const notes = grid0.map((n) => ({
    id: newId(),
    step: n.step,
    length: n.length,
    midi: n.midi + shift,
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
  }));
  const key = grid0.length ? detectKey(notes) : { tonic: 9 as const, scale: 'minor' as const };
  const raw: RawNote[] = trans.notes.map((n) => ({ ...n, start: n.start - auto.offset, end: n.end - auto.offset, midi: n.midi + shift }));
  return newRiff({
    ...baseFields(opts),
    timing: 'grid',
    bpm: Math.round(auto.bpm),
    bars: auto.bars as Bars,
    grid: auto.grid,
    key: { tonic: key.tonic, scale: key.scale },
    notes,
    capture: { raw, bpm: auto.bpm },
    ...(trans.trace ? { trace: shiftTrace(trans.trace, auto.offset, shift) } : {}),
  });
}
