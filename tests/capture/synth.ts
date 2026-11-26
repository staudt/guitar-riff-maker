// Synthetic capture fixtures (until the user's real recordings exist): melodies rendered as voice
// "da" (consonant burst + energy dip at each onset), hum, whistle (two octaves up) and plucked
// guitar, with vibrato, pitch drift and noise; plus strummed chords. Deterministic (seeded).
import type { CaptureSource } from '../../src/capture/types';

export type ExpectedNote = { start: number; end: number; midi: number };
export type Fixture = { name: string; source: CaptureSource; rate: number; audio: Float32Array; notes: ExpectedNote[]; octaveFree?: boolean };

function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Voice = 'da' | 'hum' | 'whistle' | 'guitar';

/** Renders monophonic notes. Each note has its own vibrato phase, a slight drift and attack glide. */
export function renderMelody(notes: ExpectedNote[], voice: Voice, opts: { rate?: number; seed?: number; noiseDb?: number; octave?: number } = {}): Float32Array {
  const rate = opts.rate ?? 48000;
  const r = rng(opts.seed ?? 7);
  const end = Math.max(...notes.map((n) => n.end)) + 0.4;
  const out = new Float32Array(Math.ceil(end * rate));
  const octave = opts.octave ?? 0;
  for (const n of notes) {
    const f0 = hz(n.midi + 12 * octave) * Math.pow(2, ((r() - 0.5) * 0.15) / 12); // up to ±7 cents off
    const vibHz = 4.5 + r() * 2;
    const vibDepth = voice === 'guitar' ? 0 : 0.25 + r() * 0.15; // semitones
    const vibPh = r() * Math.PI * 2;
    const a = Math.round(n.start * rate);
    const b = Math.round(n.end * rate);
    let ph = r();
    for (let i = a; i < Math.min(out.length, b + (voice === 'guitar' ? Math.round(0.05 * rate) : 0)); i++) {
      const t = (i - a) / rate;
      const len = (b - a) / rate;
      // Attack glide from 60 cents flat (voice), vibrato, slight drift.
      const glide = voice === 'da' || voice === 'hum' ? -0.6 * Math.exp(-t / 0.03) : 0;
      const semis = glide + vibDepth * Math.sin(2 * Math.PI * vibHz * t + vibPh) * Math.min(1, t / 0.15);
      const f = f0 * Math.pow(2, semis / 12);
      ph += f / rate;
      ph -= Math.floor(ph);
      let s: number;
      let env: number;
      if (voice === 'guitar') {
        // Plucked: bright saw-ish tone decaying exponentially, short attack.
        s = 0;
        for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * ph * h) / h ** 1.3;
        s *= 0.5;
        env = Math.min(1, t / 0.002) * Math.exp(-t / 0.6) * (i > b ? Math.max(0, 1 - (i - b) / (0.05 * rate)) : 1);
      } else if (voice === 'whistle') {
        s = Math.sin(2 * Math.PI * ph) + 0.03 * Math.sin(4 * Math.PI * ph);
        env = Math.min(1, t / 0.02, (len - t) / 0.03);
      } else {
        // Voice / hum: a few harmonics with a formant-ish tilt.
        s = Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph) + 0.3 * Math.sin(6 * Math.PI * ph) + 0.15 * Math.sin(8 * Math.PI * ph);
        s *= 0.5;
        env = Math.min(1, t / 0.04, (len - t) / 0.04);
        if (voice === 'da') {
          // Consonant: a short noise burst at the onset with the voice ducked under it.
          if (t < 0.025) s = s * (t / 0.025) + (r() - 0.5) * 0.6 * (1 - t / 0.025);
        }
      }
      out[i]! += 0.5 * s * Math.max(0, env);
    }
  }
  const noise = Math.pow(10, (opts.noiseDb ?? -45) / 20);
  for (let i = 0; i < out.length; i++) out[i]! += (r() - 0.5) * 2 * noise;
  return out;
}

/** Strummed chords: notes of each chord start 15 ms apart, plucked decay. */
export function renderChords(chords: { start: number; end: number; notes: number[] }[], opts: { rate?: number; seed?: number } = {}): Float32Array {
  const rate = opts.rate ?? 48000;
  const r = rng(opts.seed ?? 11);
  const end = Math.max(...chords.map((c) => c.end)) + 0.5;
  const out = new Float32Array(Math.ceil(end * rate));
  for (const c of chords) {
    c.notes.forEach((m, k) => {
      const a = Math.round((c.start + k * 0.015) * rate);
      const b = Math.round(c.end * rate);
      const f = hz(m);
      let ph = r();
      for (let i = a; i < Math.min(out.length, b + Math.round(0.05 * rate)); i++) {
        const t = (i - a) / rate;
        ph += f / rate;
        ph -= Math.floor(ph);
        let s = 0;
        for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * ph * h) / h ** 1.4;
        const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.9) * (i > b ? Math.max(0, 1 - (i - b) / (0.05 * rate)) : 1);
        out[i]! += 0.18 * s * env;
      }
    });
  }
  for (let i = 0; i < out.length; i++) out[i]! += (r() - 0.5) * 0.002;
  return out;
}

// Reference melody (A minor, eighths and quarters, repeated pitch and leaps), in beats at REF_BPM.
// Inlined from groovebox's src/capture/reference.ts, which is not ported.
const REF_BPM = 100;
const REF_MELODY: readonly [number, number][] = [
  [69, 1], [72, 0.5], [71, 0.5], [69, 1], [64, 1],
  [65, 0.5], [67, 0.5], [69, 1], [69, 0.5], [67, 0.5], [64, 1],
];

/** The melody as notes in seconds (starting at `t0`), shifted by `octave` octaves. */
function refMelodyNotes(t0 = 0, octave = 0, bpm = REF_BPM): ExpectedNote[] {
  const q = 60 / bpm;
  const out: ExpectedNote[] = [];
  let t = t0;
  for (const [m, beats] of REF_MELODY) {
    out.push({ start: t, end: t + beats * q * 0.9, midi: m + 12 * octave });
    t += beats * q;
  }
  return out;
}

/** The shared reference melody, starting at 0.3 s. */
export function melodyNotes(bpm = 100): ExpectedNote[] {
  return refMelodyNotes(0.3, 0, bpm);
}

export function fixtures(): Fixture[] {
  const notes = melodyNotes();
  const rate = 48000;
  const low = notes.map((n) => ({ ...n, midi: n.midi - 12 })); // sung an octave lower (male range)
  const chords = [
    { start: 0.3, end: 1.4, notes: [57, 60, 64] }, // Am
    { start: 1.5, end: 2.6, notes: [53, 57, 60] }, // F
    { start: 2.7, end: 3.8, notes: [48, 52, 55] }, // C
    { start: 3.9, end: 5.0, notes: [55, 59, 62] }, // G
  ];
  return [
    { name: 'voice-da', source: 'voice', rate, audio: renderMelody(low, 'da', { rate, seed: 3 }), notes: low },
    { name: 'hum', source: 'voice', rate, audio: renderMelody(low, 'hum', { rate, seed: 5 }), notes: low },
    { name: 'whistle', source: 'whistle', rate, audio: renderMelody(notes, 'whistle', { rate, seed: 9, octave: 2 }), notes, octaveFree: true },
    { name: 'guitar', source: 'guitar', rate, audio: renderMelody(low, 'guitar', { rate, seed: 13 }), notes: low },
    { name: 'voice-da-noisy', source: 'voice', rate: 44100, audio: renderMelody(low, 'da', { rate: 44100, seed: 17, noiseDb: -30 }), notes: low },
    {
      name: 'chords',
      source: 'chords',
      rate,
      audio: renderChords(chords, { rate }),
      notes: chords.flatMap((c) => c.notes.map((m) => ({ start: c.start, end: c.end, midi: m }))),
    },
  ];
}
