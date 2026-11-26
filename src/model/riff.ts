// The Riff document: everything the user edits and saves. Pure data; behaviour lives in edit.ts.
// Steps are always 16th notes; `grid` is only the edit snap. Notes are monophonic (no overlaps).
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
  /** auto: choice = index into bestRegions() (0 = cheapest). anchor: target hand position fret. */
  region: Region;
  instrument: Instrument;
  /** Sorted by step, non-overlapping, all within [0, bars*16). */
  notes: RiffNote[];
  /** The raw detected notes + capture tempo, so re-quantizing to another grid is lossless. */
  capture?: { raw: CapturedNote[]; bpm: number };
};

export const STEPS_PER_BAR = 16;
export const totalSteps = (r: Pick<Riff, 'bars'>) => r.bars * STEPS_PER_BAR;
