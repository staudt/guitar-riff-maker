// From pitch frames to notes, and from notes to the step grid.
import type { GridNote, GridSize, PitchFrame, RawNote } from './types';
import { hzToMidi } from './pitch';

const MIN_NOTE_S = 0.08; // drop notes shorter than this (spec: about 80 ms)
const JUMP_SEMIS = 0.7; // a sustained pitch change this big starts a new note
const JUMP_FRAMES = 3; // ...if it lasts this many frames
const DIP_DB = 6; // an energy dip this deep inside a voiced run splits notes ("da da")

/** Median of an array (copy-sorted). */
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

/**
 * Segments a monophonic pitch track into notes:
 * 1. voiced runs (frames with a pitch) separated by unvoiced frames,
 * 2. split inside a run at sustained pitch jumps and at energy dips (consonants),
 * 3. note pitch = median of its middle frames (ignores attack and release glides),
 * 4. drop notes shorter than 80 ms.
 */
export function segmentNotes(frames: PitchFrame[]): RawNote[] {
  if (frames.length < 2) return [];
  const dt = frames[1]!.t - frames[0]!.t;
  const maxRms = Math.max(...frames.map((f) => f.rms), 1e-9);
  const voiced = frames.map((f) => f.hz > 0 && f.rms > maxRms * 0.02); // ~-34 dB from the loudest
  const midi = frames.map((f) => (f.hz > 0 ? hzToMidi(f.hz) : NaN));
  const db = frames.map((f) => 20 * Math.log10(Math.max(f.rms, 1e-9)));

  // Split points (frame indices where a new note starts) inside voiced runs.
  const cuts = new Set<number>();
  let runStart = -1;
  for (let i = 0; i <= frames.length; i++) {
    const v = i < frames.length && voiced[i];
    if (v && runStart < 0) {
      runStart = i;
      cuts.add(i);
    }
    if (!v && runStart >= 0) {
      splitRun(runStart, i);
      runStart = -1;
    }
  }

  function splitRun(a: number, b: number): void {
    // Pitch jumps: compare each frame to the median of the current note so far.
    let noteStart = a;
    for (let i = a + 1; i < b; i++) {
      const ref = median(midi.slice(noteStart, Math.max(noteStart + 1, i)));
      let sustained = true;
      for (let k = 0; k < JUMP_FRAMES; k++) {
        const m = midi[i + k];
        if (i + k >= b || m === undefined || Math.abs(m - ref) < JUMP_SEMIS) {
          sustained = false;
          break;
        }
      }
      if (sustained && (i - noteStart) * dt >= MIN_NOTE_S * 0.5) {
        cuts.add(i);
        noteStart = i;
      }
    }
    // Energy dips: a local minimum DIP_DB below the maxima on both sides.
    for (let i = a + 2; i < b - 2; i++) {
      if (!(db[i]! <= db[i - 1]! && db[i]! <= db[i + 1]!)) continue;
      let left = -Infinity;
      for (let k = Math.max(a, i - 15); k < i; k++) left = Math.max(left, db[k]!);
      let right = -Infinity;
      for (let k = i + 1; k < Math.min(b, i + 16); k++) right = Math.max(right, db[k]!);
      if (left - db[i]! >= DIP_DB && right - db[i]! >= DIP_DB) cuts.add(i + 1);
    }
  }

  // Build notes from cut points (each note runs to the next cut or the end of its voiced run).
  const sorted = [...cuts].sort((x, y) => x - y);
  const notes: RawNote[] = [];
  for (let c = 0; c < sorted.length; c++) {
    const a = sorted[c]!;
    let b = a;
    const limit = sorted[c + 1] ?? frames.length;
    while (b < limit && voiced[b]) b++;
    if (b <= a) continue;
    const dur = (b - a) * dt;
    if (dur < MIN_NOTE_S) continue;
    const trim = Math.floor((b - a) * 0.2);
    const mid = midi.slice(a + trim, Math.max(a + trim + 1, b - trim)).filter((m) => !Number.isNaN(m));
    if (!mid.length) continue;
    const peak = Math.max(...frames.slice(a, b).map((f) => f.rms));
    notes.push({ start: frames[a]!.t - dt / 2, end: frames[b - 1]!.t + dt / 2, midi: median(mid), velocity: Math.min(127, Math.round(60 + 67 * Math.min(1, peak / maxRms))) });
  }
  return notes;
}

/**
 * Quantizes notes (seconds from bar 0) to a 1/8 or 1/16 grid at `bpm`, keeping them monophonic:
 * overlapping notes are cut at the next onset, and two notes landing on one step keep the longer.
 */
export function quantize(notes: RawNote[], bpm: number, grid: GridSize, totalSteps: number): GridNote[] {
  const stepS = 60 / bpm / 4;
  const g = grid === 8 ? 2 : 1;
  const q = (t: number) => Math.round(t / stepS / g) * g;
  const byStep = new Map<number, GridNote & { dur: number }>();
  for (const n of notes) {
    const step = q(n.start);
    if (step < 0 || step >= totalSteps) continue;
    const length = Math.max(g, q(n.end) - step);
    const cand = { step, length, midi: Math.round(n.midi), velocity: n.velocity, dur: n.end - n.start };
    const prev = byStep.get(step);
    if (!prev || cand.dur > prev.dur) byStep.set(step, cand);
  }
  const out = [...byStep.values()].sort((a, b) => a.step - b.step);
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const end = Math.min(next ? next.step : totalSteps, out[i]!.step + out[i]!.length);
    out[i]!.length = Math.max(1, end - out[i]!.step);
  }
  return out.map(({ dur: _d, ...n }) => n);
}
