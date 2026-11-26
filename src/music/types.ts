// Shared music primitives. Kept identical to groovebox's store/types so ported capture code type-checks.

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** MIDI note number (60 = C4). Integer once quantized. */
export type Midi = number;
export type ScaleName = 'minor' | 'major' | 'dorian' | 'mixolydian' | 'pentatonic';

/** A place on the neck. string 0 = lowest-pitched string (low E in standard); fret 0 = open. */
export type Pos = { string: number; fret: number };

/** Open-string pitches, lowest string first. */
export type Tuning = { name: string; strings: Midi[] };
