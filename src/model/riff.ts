// The Riff document: everything the user edits and saves. Pure data; behaviour lives in edit.ts.
// Steps are always 16th notes; `grid` is only the edit snap. Notes are monophonic (no overlaps).
import { z } from 'zod';
import type { Midi, PitchClass, Pos, ScaleName, Tuning } from '../music/types';

/** Structurally identical to capture/types RawNote (seconds, fractional midi). Kept for lossless requantize. */
export type CapturedNote = { start: number; end: number; midi: number; velocity: number };

export type RiffNote = {
  id: string;
  /** Onset in 16th steps from bar 1. */
  step: number;
  /** Length in 16th steps, >= 1. */
  length: number;
  midi: Midi;
  /** 1..127 */
  velocity: number;
  /** User-chosen place on the neck; overrides automatic fingering for this note. */
  pin?: Pos;
};

export type PowerMode = 'off' | 'r5' | 'r58';
export type Instrument = 'clean' | 'drive' | 'guide';
export type GridSize = 8 | 16;
export type Bars = 1 | 2 | 4 | 8;
export type Region = { mode: 'auto'; choice: number } | { mode: 'anchor'; fret: number };

export type Riff = {
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  timeSig: [4, 4];
  grid: GridSize;
  bars: Bars;
  key: { tonic: PitchClass; scale: ScaleName };
  tuning: Tuning;
  maxFret: number;
  power: PowerMode;
  /** auto: choice = index into bestRegions() (sorted low→high on the neck); -1 = cheapest. anchor: target hand fret. */
  region: Region;
  instrument: Instrument;
  /** Sorted by step, non-overlapping, all within [0, bars*16). */
  notes: RiffNote[];
  /** The raw detected notes + capture tempo, so re-quantizing to another grid is lossless. */
  capture?: { raw: CapturedNote[]; bpm: number };
};

export const STEPS_PER_BAR = 16;
export const totalSteps = (r: Pick<Riff, 'bars'>) => r.bars * STEPS_PER_BAR;

// ---------------------------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------------------------
/** Standard guitar tuning, low to high (E2 A2 D3 G3 B3 E4). Local copy so this module has no tuning.ts dependency. */
export const DEFAULT_TUNING: Tuning = { name: 'Standard', strings: [40, 45, 50, 55, 59, 64] };

let idCounter = 0;
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  idCounter += 1;
  return `n${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newRiff(partial: Partial<Riff> = {}): Riff {
  const now = Date.now();
  return {
    v: 1,
    id: newId(),
    name: 'Untitled riff',
    createdAt: now,
    updatedAt: now,
    bpm: 96,
    timeSig: [4, 4],
    grid: 16,
    bars: 2,
    key: { tonic: 9, scale: 'minor' },
    tuning: { name: DEFAULT_TUNING.name, strings: [...DEFAULT_TUNING.strings] },
    maxFret: 22,
    power: 'off',
    region: { mode: 'auto', choice: -1 },
    instrument: 'clean',
    notes: [],
    ...partial,
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Enforces the riff invariants: notes sorted by step, monophonic, inside [0, totalSteps), integer
 * step/length, velocity 1..127, midi 0..127. Same-step duplicates keep the later-in-array note.
 * Returns a new riff; does not touch updatedAt.
 */
export function normalize(r: Riff): Riff {
  const total = totalSteps(r);
  const cands: { n: RiffNote; i: number }[] = [];
  r.notes.forEach((n, i) => {
    const step = Math.round(n.step);
    let length = Math.round(n.length);
    if (!Number.isFinite(step) || !Number.isFinite(length)) return;
    if (step < 0 || step >= total || length < 1) return;
    length = Math.min(length, total - step);
    cands.push({
      i,
      n: {
        ...n,
        step,
        length,
        midi: clamp(Math.round(n.midi), 0, 127),
        velocity: clamp(Math.round(n.velocity), 1, 127),
      },
    });
  });
  cands.sort((a, b) => a.n.step - b.n.step || a.i - b.i);
  const uniq: RiffNote[] = [];
  for (const c of cands) {
    const last = uniq[uniq.length - 1];
    if (last && last.step === c.n.step) uniq[uniq.length - 1] = c.n;
    else uniq.push(c.n);
  }
  for (let k = 0; k < uniq.length - 1; k++) {
    const a = uniq[k]!;
    const b = uniq[k + 1]!;
    if (a.step + a.length > b.step) uniq[k] = { ...a, length: b.step - a.step };
  }
  return { ...r, notes: uniq };
}

const PosSchema = z.object({ string: z.number().int().min(0), fret: z.number().int().min(0) });
const NoteSchema = z.object({
  id: z.string(),
  step: z.number(),
  length: z.number(),
  midi: z.number(),
  velocity: z.number(),
  pin: PosSchema.optional(),
});

export const RiffSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  bpm: z.number().min(1),
  timeSig: z.tuple([z.literal(4), z.literal(4)]),
  grid: z.union([z.literal(8), z.literal(16)]),
  bars: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
  key: z.object({
    tonic: z.number().int().min(0).max(11),
    scale: z.enum(['minor', 'major', 'dorian', 'mixolydian', 'pentatonic']),
  }),
  tuning: z.object({ name: z.string(), strings: z.array(z.number()).min(1) }),
  maxFret: z.number().int().min(1).max(36),
  power: z.enum(['off', 'r5', 'r58']),
  region: z.union([
    z.object({ mode: z.literal('auto'), choice: z.number().int().min(-1) }),
    z.object({ mode: z.literal('anchor'), fret: z.number().int().min(0) }),
  ]),
  instrument: z.enum(['clean', 'drive', 'guide']),
  notes: z.array(NoteSchema),
  capture: z
    .object({
      raw: z.array(z.object({ start: z.number(), end: z.number(), midi: z.number(), velocity: z.number() })),
      bpm: z.number(),
    })
    .optional(),
});

/** Upgrades older stored shapes to the current one. Only v1 exists, so this is a pass-through. */
export function migrate(raw: unknown): unknown {
  return raw;
}

/** Validates unknown input (e.g. from storage or import) into a normalized Riff. Throws on junk. */
export function parseRiff(raw: unknown): Riff {
  const parsed = RiffSchema.parse(migrate(raw));
  return normalize(parsed as unknown as Riff);
}
