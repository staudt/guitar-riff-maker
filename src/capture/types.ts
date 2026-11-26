// Melody capture: shared types (UI <-> analysis). All times in seconds, pitches in MIDI (float when raw).
import type { Midi, PitchClass, ScaleName } from '../music/types';

/** What the user is capturing. Narrows the pitch range and onset weighting; 'chords' = polyphonic. */
export type CaptureSource = 'voice' | 'whistle' | 'guitar' | 'chords';

/** One analysis frame of the live tracker. hz = 0 when unvoiced. clarity 0..1 (periodicity). */
export type PitchFrame = { t: number; hz: number; clarity: number; rms: number };

/** A transcribed note before quantizing. midi is fractional for monophonic tracking (mean pitch). */
export type RawNote = { start: number; end: number; midi: number; velocity: number };

/** A note on the step grid: start step and length in 16th steps (grid = 1/8 uses even steps). */
export type GridNote = { step: number; length: number; midi: Midi; velocity: number };

/** A captured chord (polyphonic mode): several notes sharing a start. */
export type GridChord = { step: number; length: number; notes: Midi[]; velocity: number };

export type DetectedKey = { tonic: PitchClass; scale: ScaleName; score: number };

export type Transcription = {
  source: CaptureSource;
  /** Notes in seconds, relative to the start of the recorded bars (latency already removed). */
  notes: RawNote[];
  /** True if Basic Pitch produced the notes; false if the live tracker was the fallback. */
  model: boolean;
};

export type GridSize = 8 | 16;
