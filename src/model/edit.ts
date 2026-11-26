// Pure riff editing: `reduce(riff, action)` returns a normalized riff. It never touches updatedAt (the store does).
import { inScale, SCALES } from '../music/theory';
import type { Midi, PitchClass, Pos, ScaleName, Tuning } from '../music/types';
import {
  newId,
  normalize,
  totalSteps,
  type Bars,
  type CapturedNote,
  type GridSize,
  type Instrument,
  type PowerMode,
  type Region,
  type Riff,
  type RiffNote,
} from './riff';

export type Action =
  | { type: 'add'; step: number; midi: Midi; length?: number; velocity?: number; id?: string }
  | { type: 'delete'; ids: string[] }
  | { type: 'move'; id: string; step: number }
  | { type: 'resize'; id: string; length: number }
  | { type: 'nudge'; ids: string[]; dir: -1 | 1 }
  | { type: 'bump'; id: string; dir: -1 | 1; snapToScale?: boolean }
  | { type: 'octave'; id: string; dir: -1 | 1 }
  | { type: 'setPitch'; id: string; midi: Midi }
  | { type: 'split'; id: string; newId?: string }
  | { type: 'merge'; id: string }
  | { type: 'setGrid'; grid: GridSize }
  | { type: 'requantize'; grid: GridSize }
  | { type: 'halfTime' }
  | { type: 'doubleTime' }
  | { type: 'transpose'; semis: number }
  | { type: 'transposeDiatonic'; steps: number }
  | { type: 'setKey'; tonic: PitchClass; scale: ScaleName; moveNotes: boolean }
  | { type: 'fixOutOfKey' }
  | { type: 'setBpm'; bpm: number }
  | { type: 'setBars'; bars: Bars }
  | { type: 'pin'; id: string; pos: Pos }
  | { type: 'unpin'; id: string }
  | { type: 'setRegion'; region: Region }
  | { type: 'setPower'; power: PowerMode }
  | { type: 'setTuning'; tuning: Tuning }
  | { type: 'setInstrument'; instrument: Instrument }
  | { type: 'rename'; name: string }
  | { type: 'setVelocity'; id: string; velocity: number };

/** Edit-snap size in 16th steps: grid 16 -> 1, grid 8 -> 2. */
export const gridUnit = (grid: GridSize): number => 16 / grid;

/** True when every note stays within [lo, hi] after shifting an octave in `dir`. */
export function canOctave(riff: Riff, dir: -1 | 1, lo: Midi, hi: Midi): boolean {
  return riff.notes.every((n) => n.midi + 12 * dir >= lo && n.midi + 12 * dir <= hi);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (a: number, n: number) => ((a % n) + n) % n;

function mapNote(r: Riff, id: string, f: (n: RiffNote) => RiffNote): Riff {
  return { ...r, notes: r.notes.map((n) => (n.id === id ? f(n) : n)) };
}

function withoutPin(n: RiffNote): RiffNote {
  const { pin: _pin, ...rest } = n;
  return rest;
}

/** Local quantizer for raw captured notes (seconds -> 16th steps on a g-step grid). */
export function quantizeRaw(raw: CapturedNote[], bpm: number, grid: GridSize, total: number): RiffNote[] {
  const g = gridUnit(grid);
  const stepSec = 60 / bpm / 4;
  const byStep = new Map<number, { dur: number; n: CapturedNote }>();
  for (const n of raw) {
    const step = Math.round(n.start / stepSec / g) * g;
    if (step < 0 || step >= total) continue;
    const dur = n.end - n.start;
    const cur = byStep.get(step);
    if (!cur || dur > cur.dur) byStep.set(step, { dur, n });
  }
  const out: RiffNote[] = [];
  for (const [step, { dur, n }] of byStep) {
    const v = n.velocity <= 1 ? n.velocity * 127 : n.velocity;
    out.push({
      id: newId(),
      step,
      length: Math.max(g, Math.round(dur / stepSec / g) * g),
      midi: Math.round(n.midi),
      velocity: Math.max(1, Math.min(127, Math.round(v))),
    });
  }
  return out.sort((a, b) => a.step - b.step);
}

function snapExisting(notes: RiffNote[], grid: GridSize): RiffNote[] {
  const g = gridUnit(grid);
  const byStep = new Map<number, RiffNote>();
  for (const n of notes) {
    const step = Math.round(n.step / g) * g;
    const cand = { ...n, step, length: Math.max(g, Math.round(n.length / g) * g) };
    const cur = byStep.get(step);
    if (!cur || n.length > cur.length) byStep.set(step, cand);
  }
  return [...byStep.values()];
}

function shiftPin(n: RiffNote, semis: number, maxFret: number): RiffNote {
  if (!n.pin) return n;
  const fret = n.pin.fret + semis;
  if (fret < 0 || fret > maxFret) return withoutPin(n);
  return { ...n, pin: { string: n.pin.string, fret } };
}

function transposeAll(r: Riff, semis: number): Riff {
  return {
    ...r,
    key: { ...r.key, tonic: mod(r.key.tonic + semis, 12) as PitchClass },
    notes: r.notes.map((n) => shiftPin({ ...n, midi: n.midi + semis }, semis, r.maxFret)),
  };
}

function nearestScaleMidi(midi: Midi, key: PitchClass, scale: ScaleName): Midi {
  if (inScale(midi, key, scale)) return midi;
  for (let d = 1; d <= 12; d++) {
    if (inScale(midi - d, key, scale)) return midi - d;
    if (inScale(midi + d, key, scale)) return midi + d;
  }
  return midi;
}

function diatonicShift(midi: Midi, key: PitchClass, scale: ScaleName, steps: number): Midi {
  const iv = SCALES[scale];
  const n = iv.length;
  const snapped = nearestScaleMidi(midi, key, scale);
  const rel = snapped - key;
  const oct = Math.floor(rel / 12);
  const k = iv.indexOf(mod(rel, 12));
  const idx = oct * n + k + steps;
  return key + Math.floor(idx / n) * 12 + iv[mod(idx, n)]!;
}

function bumpPitch(n: RiffNote, dir: -1 | 1, r: Riff, snap: boolean): number {
  let m = n.midi + dir;
  if (snap) for (let i = 0; i < 12 && !inScale(m, r.key.tonic, r.key.scale); i++) m += dir;
  return clamp(m, 0, 127);
}


function rescale(r: Riff, factor: number, bars: number): Riff {
  return {
    ...r,
    bars: bars as Bars,
    notes: r.notes.map((n) => ({
      ...n,
      step: Math.round(n.step * factor),
      length: Math.max(1, Math.round(n.length * factor)),
    })),
  };
}

export function reduce(riff: Riff, a: Action): Riff {
  return normalize(apply(riff, a));
}

function apply(r: Riff, a: Action): Riff {
  const u = gridUnit(r.grid);
  const total = totalSteps(r);
  switch (a.type) {
    case 'add':
      return {
        ...r,
        notes: [
          ...r.notes,
          { id: a.id ?? newId(), step: a.step, midi: a.midi, length: a.length ?? u, velocity: a.velocity ?? 100 },
        ],
      };
    case 'delete': {
      const ids = new Set(a.ids);
      return { ...r, notes: r.notes.filter((n) => !ids.has(n.id)) };
    }
    case 'move': {
      const n = r.notes.find((x) => x.id === a.id);
      if (!n) return r;
      // Moved note goes last so it wins a same-step collision.
      return { ...r, notes: [...r.notes.filter((x) => x.id !== a.id), { ...n, step: clamp(a.step, 0, total - 1) }] };
    }
    case 'resize':
      return mapNote(r, a.id, (n) => ({ ...n, length: Math.max(1, a.length) }));
    case 'nudge': {
      const ids = new Set(a.ids);
      const moved: RiffNote[] = [];
      const rest: RiffNote[] = [];
      for (const n of r.notes) {
        if (ids.has(n.id)) moved.push({ ...n, step: clamp(n.step + a.dir * u, 0, total - 1) });
        else rest.push(n);
      }
      return { ...r, notes: [...rest, ...moved] };
    }
    case 'bump':
      return mapNote(r, a.id, (n) => ({ ...withoutPin(n), midi: bumpPitch(n, a.dir, r, !!a.snapToScale) }));
    case 'octave':
      return mapNote(r, a.id, (n) => {
        const m = n.midi + 12 * a.dir;
        return m < 0 || m > 127 ? n : { ...withoutPin(n), midi: m };
      });
    case 'setPitch':
      return mapNote(r, a.id, (n) => ({ ...withoutPin(n), midi: a.midi }));
    case 'split': {
      const n = r.notes.find((x) => x.id === a.id);
      if (!n || n.length < 2) return r;
      const mid = Math.round((n.step + n.length / 2) / u) * u;
      const at = clamp(mid, n.step + 1, n.step + n.length - 1);
      const second: RiffNote = { ...n, id: a.newId ?? newId(), step: at, length: n.step + n.length - at };
      return { ...r, notes: [...r.notes.map((x) => (x.id === n.id ? { ...n, length: at - n.step } : x)), second] };
    }
    case 'merge': {
      const sorted = [...r.notes].sort((x, y) => x.step - y.step);
      const i = sorted.findIndex((x) => x.id === a.id);
      const n = sorted[i];
      const next = sorted[i + 1];
      if (!n || !next) return r;
      const end = next.step + next.length;
      return { ...r, notes: r.notes.filter((x) => x.id !== next.id).map((x) => (x.id === n.id ? { ...n, length: end - n.step } : x)) };
    }
    case 'setGrid':
      return { ...r, grid: a.grid };
    case 'requantize': {
      const base = { ...r, grid: a.grid };
      if (r.capture) return { ...base, notes: quantizeRaw(r.capture.raw, r.capture.bpm, a.grid, total) };
      return { ...base, notes: snapExisting(r.notes, a.grid) };
    }
    case 'halfTime':
      return rescale(r, 2, Math.min(8, r.bars * 2));
    case 'doubleTime':
      return rescale(r, 0.5, Math.max(1, r.bars / 2));
    case 'transpose':
      return transposeAll(r, a.semis);
    case 'transposeDiatonic':
      return {
        ...r,
        notes: r.notes.map((n) => ({
          ...withoutPin(n),
          midi: diatonicShift(n.midi, r.key.tonic, r.key.scale, a.steps),
        })),
      };
    case 'setKey': {
      if (!a.moveNotes) return { ...r, key: { tonic: a.tonic, scale: a.scale } };
      const d = mod(a.tonic - r.key.tonic + 6, 12) - 6; // -6..+5
      const t = transposeAll(r, d);
      return { ...t, key: { tonic: a.tonic, scale: a.scale } };
    }
    case 'fixOutOfKey':
      return {
        ...r,
        notes: r.notes.map((n) => {
          const m = nearestScaleMidi(n.midi, r.key.tonic, r.key.scale);
          return m === n.midi ? n : { ...withoutPin(n), midi: m };
        }),
      };
    case 'setBpm':
      return { ...r, bpm: clamp(Math.round(a.bpm), 30, 300) };
    case 'setBars':
      return { ...r, bars: a.bars };
    case 'pin':
      return mapNote(r, a.id, (n) => ({ ...n, pin: { ...a.pos } }));
    case 'unpin':
      return mapNote(r, a.id, withoutPin);
    case 'setRegion':
      return { ...r, region: a.region };
    case 'setPower':
      return { ...r, power: a.power };
    case 'setTuning':
      return { ...r, tuning: a.tuning, notes: r.notes.map(withoutPin) };
    case 'setInstrument':
      return { ...r, instrument: a.instrument };
    case 'rename':
      return { ...r, name: a.name };
    case 'setVelocity':
      return mapNote(r, a.id, (n) => ({ ...n, velocity: a.velocity }));
  }
}
