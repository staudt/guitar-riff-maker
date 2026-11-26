// Main thread <-> AudioWorklet messages. The worklet owns all timing; the UI only reacts to events.

/** One scheduled note. midis has 1 entry for single notes, 2-3 for power chords. index = position in riff.notes. */
export type PNote = { step: number; length: number; midis: number[]; vel: number; index: number };

export type InstrumentKind = 'clean' | 'drive' | 'guide';

export type Cmd =
  | { type: 'riff'; notes: PNote[]; totalSteps: number }
  /** Effective tempo = bpm * rate. rate 0.25..1.25 (lesson slow-down). */
  | { type: 'tempo'; bpm: number; rate: number }
  /** Loop range in steps; end <= start means the whole riff. */
  | { type: 'loop'; start: number; end: number }
  | { type: 'play'; from: number; countInBeats: 0 | 4 | 8 }
  | { type: 'stop' }
  | { type: 'metronome'; on: boolean; gain: number }
  | { type: 'instrument'; kind: InstrumentKind }
  /** Play immediately, outside the transport (editing / step mode). */
  | { type: 'audition'; midis: number[]; vel: number; seconds: number }
  | { type: 'volume'; gain: number }
  | { type: 'panic' };

export type Evt =
  /** Heard at AudioContext time `time`. step < 0 = count-in (one event per beat: -16,-12,-8,-4 for 4 beats). */
  | { type: 'step'; step: number; time: number }
  /** riff.notes[index] starts sounding at `time`. */
  | { type: 'note'; index: number; time: number }
  | { type: 'stopped' };
