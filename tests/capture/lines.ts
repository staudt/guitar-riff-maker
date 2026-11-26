// Whistle/hum "riff line" fixtures for segmentation quality: re-articulated repeats (amplitude
// dips instead of silence), fast notes, legato steps, glides, vibrato and octave glitches.
import type { PitchFrame } from '../../src/capture/types';
import type { ExpectedNote } from './synth';

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export type LineOpts = {
  rate?: number;
  seed?: number;
  /** Amplitude (0..1) inside the gaps between notes; 0 = silence. */
  gapLevel?: number;
  /** Portamento into each note, ms. */
  glideMs?: number;
  /** Vibrato depth in semitones (peak) and rate. */
  vib?: number;
  vibHz?: number;
  voice?: 'whistle' | 'hum';
  noiseDb?: number;
};

/** Continuous-phase tone following `notes` (sorted, seconds). Pitch glides into each note; amplitude dips in the gaps. */
export function renderLine(notes: ExpectedNote[], o: LineOpts = {}): Float32Array {
  const rate = o.rate ?? 44100;
  const r = rng(o.seed ?? 5);
  const gap = o.gapLevel ?? 0;
  const glide = (o.glideMs ?? 15) / 1000;
  const vib = o.vib ?? 0.25;
  const vibHz = o.vibHz ?? 5.5;
  const n = Math.ceil((notes[notes.length - 1]!.end + 0.4) * rate);
  const out = new Float32Array(n);
  let k = 0;
  let ph = 0;
  let amp = 0;
  const edge = 1 - Math.exp(-1 / (0.006 * rate)); // ~6 ms one-pole
  const noise = Math.pow(10, (o.noiseDb ?? -45) / 20);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    while (k + 1 < notes.length && t >= notes[k + 1]!.start) k++;
    const cur = notes[k]!;
    const prev = notes[k - 1];
    const inNote = t >= cur.start && t < cur.end;
    let m = cur.midi;
    if (t >= cur.start && t < cur.start + glide) {
      const from = prev ? prev.midi : cur.midi - 1.2;
      m = from + (cur.midi - from) * ((t - cur.start) / glide);
    } else if (t < cur.start) m = prev ? prev.midi : cur.midi - 1.2;
    const target = t < cur.start && !prev ? 0 : inNote ? 1 : gap;
    amp += (target - amp) * edge;
    const semis = vib * Math.sin(2 * Math.PI * vibHz * t) * Math.min(1, Math.max(0, (t - cur.start) / 0.15));
    ph += hz(m + semis) / rate;
    ph -= Math.floor(ph);
    const s = o.voice === 'hum'
      ? 0.5 * (Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph) + 0.3 * Math.sin(6 * Math.PI * ph))
      : Math.sin(2 * Math.PI * ph) + 0.03 * Math.sin(4 * Math.PI * ph);
    out[i] = 0.5 * amp * s + (r() - 0.5) * 2 * noise;
  }
  return out;
}

export type LineSpec = { dur: number; midi: number; gap: number };
/** Lays specs out from t0: each note lasts dur, then `gap` seconds before the next. */
export function layout(specs: LineSpec[], t0 = 0.4): ExpectedNote[] {
  let t = t0;
  return specs.map((s) => {
    const n = { start: t, end: t + s.dur, midi: s.midi };
    t += s.dur + s.gap;
    return n;
  });
}

export type LineFixture = {
  name: string;
  source: 'whistle' | 'voice';
  rate: number;
  audio: Float32Array;
  notes: ExpectedNote[];
  /** Applied to the tracked frames (to inject tracker errors). */
  post?: (f: PitchFrame[]) => PitchFrame[];
};

const S = (dur: number, midi: number, gap: number): LineSpec => ({ dur, midi, gap });

export function lineFixtures(): LineFixture[] {
  const rate = 44100;
  const out: LineFixture[] = [];
  const add = (name: string, specs: LineSpec[], o: LineOpts, extra: Partial<LineFixture> = {}) => {
    const notes = layout(specs);
    out.push({ name, source: o.voice === 'hum' ? 'voice' : 'whistle', rate, notes, audio: renderLine(notes, { rate, ...o }), ...extra });
  };
  // Re-articulated repeats: same pitch, 40-120 ms gaps with amplitude dips (not silence).
  add('repeat-dips', [S(.2, 88, .04), S(.18, 88, .08), S(.2, 88, .12), S(.25, 91, .06), S(.2, 91, .1), S(.2, 91, .05), S(.3, 86, .09), S(.22, 86, .07), S(.4, 88, .1)], { gapLevel: 0.3, seed: 2 });
  add('repeat-dips-deep', [S(.15, 84, .05), S(.15, 84, .06), S(.15, 84, .07), S(.15, 84, .08), S(.2, 87, .06), S(.2, 87, .1), S(.3, 84, .1)], { gapLevel: 0.12, seed: 3 });
  add('repeat-silence', [S(.2, 88, .05), S(.2, 88, .08), S(.2, 88, .12), S(.2, 90, .05), S(.2, 90, .06), S(.3, 88, .1)], { gapLevel: 0, seed: 4 });
  // Fast notes.
  add('fast', [S(.1, 86, .03), S(.12, 88, .03), S(.1, 90, .03), S(.15, 91, .03), S(.12, 90, .03), S(.1, 88, .03), S(.14, 86, .03), S(.15, 84, .03), S(.3, 86, .05)], { gapLevel: 0.25, seed: 6 });
  add('fast-legato', [S(.12, 86, 0), S(.12, 88, 0), S(.12, 91, 0), S(.15, 90, 0), S(.12, 88, 0), S(.12, 86, 0), S(.15, 84, 0), S(.3, 86, 0)], { gapLevel: 0.25, seed: 8, glideMs: 12 });
  // Legato steps: pitch change only, no dip.
  add('legato', [S(.3, 84, 0), S(.25, 87, 0), S(.3, 89, 0), S(.25, 86, 0), S(.3, 85, 0), S(.4, 84, 0)], { gapLevel: 1, seed: 9, glideMs: 15 });
  add('legato-semitone', [S(.3, 84, 0), S(.3, 85, 0), S(.3, 86, 0), S(.3, 85, 0), S(.4, 84, 0)], { gapLevel: 1, seed: 10, glideMs: 15 });
  // Scoops/glides: 60 ms portamento into each note.
  add('glides', [S(.28, 84, .06), S(.28, 88, .06), S(.28, 91, .06), S(.28, 86, .06), S(.4, 84, .05)], { gapLevel: 0.2, glideMs: 60, seed: 12 });
  add('glides-legato', [S(.3, 84, 0), S(.3, 88, 0), S(.3, 86, 0), S(.3, 91, 0), S(.4, 84, 0)], { gapLevel: 1, glideMs: 60, seed: 13 });
  // Vibrato on long notes.
  add('vibrato', [S(.7, 84, .08), S(.6, 88, .08), S(.8, 86, .1), S(.6, 86, .08), S(.7, 84, 0)], { gapLevel: 0.2, vib: 0.5, vibHz: 5.5, seed: 14 });
  add('vibrato-deep', [S(.8, 84, .1), S(.7, 87, .1), S(.9, 84, .1)], { gapLevel: 0.1, vib: 0.7, vibHz: 6, seed: 15 });
  // Octave glitches injected into the tracked line (1-2 frames).
  const glitch = (f: PitchFrame[]): PitchFrame[] =>
    f.map((x, i) => (x.hz > 0 && (i % 23 === 7 || i % 41 === 20 || i % 41 === 21) ? { ...x, hz: x.hz * (i % 2 ? 2 : 0.5) } : x));
  add('octave-glitch', [S(.3, 86, .05), S(.3, 88, 0), S(.3, 91, .06), S(.3, 88, .06), S(.4, 86, .05)], { gapLevel: 0.2, seed: 16 }, { post: glitch });
  // Harder: shallow dips (-6 dB), noise, tracker dropouts inside notes, deep vibrato with repeats.
  add('repeat-shallow', [S(.2, 88, .06), S(.2, 88, .08), S(.2, 88, .1), S(.25, 90, .06), S(.2, 90, .08), S(.3, 88, .1)], { gapLevel: 0.5, seed: 21 });
  add('repeat-noisy', [S(.2, 88, .05), S(.18, 88, .08), S(.2, 91, .1), S(.2, 91, .06), S(.2, 89, .06), S(.3, 88, .1)], { gapLevel: 0.25, noiseDb: -32, seed: 22 });
  const dropouts = (f: PitchFrame[]): PitchFrame[] =>
    f.map((x, i) => (x.hz > 0 && (i % 29 === 11 || i % 29 === 12 || i % 53 === 30) ? { ...x, hz: 0, clarity: 0.3 } : x));
  add('dropouts', [S(.3, 86, .06), S(.3, 86, .08), S(.4, 89, 0), S(.3, 87, .06), S(.4, 86, .1)], { gapLevel: 0.2, seed: 23 }, { post: dropouts });
  add('vibrato-repeat', [S(.4, 84, .07), S(.4, 84, .08), S(.4, 86, 0), S(.4, 84, .09)], { gapLevel: 0.3, vib: 0.55, vibHz: 6, seed: 24 });
  // Hum (voice-like harmonics) riff.
  add('hum-repeat', [S(.25, 57, .08), S(.2, 57, .07), S(.25, 60, .06), S(.2, 62, 0), S(.3, 60, .08), S(.3, 57, .1)], { voice: 'hum', gapLevel: 0.3, seed: 17 });
  // Realistic mix.
  add('riff-mix', [S(.18, 86, .05), S(.15, 86, .05), S(.3, 89, .04), S(.15, 88, 0), S(.15, 86, 0), S(.3, 84, .08), S(.12, 84, .06), S(.12, 86, .04), S(.5, 88, .1), S(.2, 91, .06)], { gapLevel: 0.2, glideMs: 40, seed: 18, vib: 0.35 });
  return out;
}
