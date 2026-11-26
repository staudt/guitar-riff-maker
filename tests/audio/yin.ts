// Monophonic pitch tracking: YIN (de Cheveigné & Kawahara 2002) on 16 kHz audio, 100 frames per
// second, with a clarity threshold and a 5-frame median filter. Written for this project.
// Runs in a Web Worker for live capture and in Node for tests.
type CaptureSource = 'voice' | 'whistle' | 'guitar' | 'chords';
type PitchFrame = { t: number; hz: number; clarity: number; rms: number };

export const TRACK_RATE = 16000;
export const FRAME_HZ = 100;
const HOP = TRACK_RATE / FRAME_HZ; // 160 samples

/** Pitch range per source (Hz). 'chords' tracks the strongest voice for display only. */
export const SOURCE_RANGE: Record<CaptureSource, [number, number]> = {
  voice: [70, 1100],
  whistle: [400, 4000],
  guitar: [70, 1400],
  chords: [60, 1400],
};

/** Clarity at or above this marks a frame as voiced. */
export const CLARITY_MIN = 0.7;

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Resamples to 16 kHz (whistles up to 4 kHz survive). Returns the input if it already is 16 kHz. */
export function resampleTo16k(x: Float32Array, rate: number): Float32Array {
  return resample(x, rate, TRACK_RATE);
}

/** Band-limited resampling from `from` to `to` Hz (windowed sinc; fine for analysis, not for playback). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  const cutoff = Math.min(1, 1 / ratio) * 0.9; // normalized to the input Nyquist
  const half = 8;
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const i0 = Math.floor(c);
    let acc = 0;
    let wsum = 0;
    for (let k = i0 - half * Math.ceil(ratio); k <= i0 + half * Math.ceil(ratio); k++) {
      if (k < 0 || k >= x.length) continue;
      const d = k - c;
      const arg = Math.PI * d * cutoff;
      const sinc = d === 0 ? 1 : Math.sin(arg) / arg;
      const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / (half * Math.ceil(ratio) + 1));
      const w = sinc * win;
      acc += x[k]! * w;
      wsum += w;
    }
    out[i] = wsum > 0 ? acc / wsum : 0;
  }
  return out;
}

/**
 * YIN for one frame starting at `at`. Uses `w` samples of difference window and lags in
 * [tauMin, tauMax]. Returns hz (0 if unvoiced) and clarity (1 - CMNDF at the chosen lag).
 * `d` is a scratch array of length >= tauMax + 2.
 */
export function yinFrame(x: Float32Array, at: number, w: number, tauMin: number, tauMax: number, d: Float64Array, threshold = 0.12, raw: Float64Array = new Float64Array(tauMax + 2)): { hz: number; clarity: number } {
  if (at + w + tauMax + 1 > x.length) return { hz: 0, clarity: 0 };
  // Difference function.
  d[0] = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const v = x[at + j]! - x[at + j + tau]!;
      s += v * v;
    }
    d[tau] = s;
  }
  // Cumulative mean normalized difference (raw values kept in `raw` for interpolation).
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    raw[tau] = d[tau]!;
    run += d[tau]!;
    d[tau] = run > 0 ? (d[tau]! * tau) / run : 1;
  }
  // First dip below the threshold (then its local minimum), else the global minimum.
  let best = -1;
  for (let tau = Math.max(2, tauMin); tau <= tauMax; tau++) {
    if (d[tau]! < threshold) {
      while (tau + 1 <= tauMax && d[tau + 1]! < d[tau]!) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let m = Infinity;
    for (let tau = Math.max(2, tauMin); tau <= tauMax; tau++) {
      if (d[tau]! < m) {
        m = d[tau]!;
        best = tau;
      }
    }
  }
  if (best < 1) return { hz: 0, clarity: 0 };
  // Parabolic interpolation on the RAW difference function: the normalized one is biased at short
  // lags (high pitches: a 3 kHz whistle is only ~5 samples per period at 16 kHz).
  // Very short periods: measure at the n-th repetition of the period (the dip repeats there) and
  // divide by n, which shrinks the interpolation error by n.
  let n = 1;
  let at2 = best;
  if (best < 24) {
    n = Math.min(Math.floor(tauMax / best), Math.ceil(24 / best));
    const c0 = best * n;
    at2 = c0;
    for (let t = Math.max(2, c0 - 2); t <= Math.min(tauMax, c0 + 2); t++) if (raw[t]! < raw[at2]!) at2 = t;
  }
  const a = raw[at2 - 1]!;
  const b = raw[at2]!;
  const c = raw[at2 + 1]!;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const tau = (at2 + Math.max(-0.5, Math.min(0.5, shift))) / n;
  return { hz: TRACK_RATE / tau, clarity: Math.max(0, Math.min(1, 1 - d[best]!)) };
}

/** Streaming-friendly tracker state for one source (lag range and scratch buffers). */
export class PitchTracker {
  readonly tauMin: number;
  readonly tauMax: number;
  readonly w: number;
  private readonly d: Float64Array;
  private readonly raw: Float64Array;

  constructor(source: CaptureSource) {
    const [lo, hi] = SOURCE_RANGE[source];
    this.tauMin = Math.max(2, Math.floor(TRACK_RATE / hi));
    this.tauMax = Math.ceil(TRACK_RATE / lo);
    this.w = Math.max(256, this.tauMax); // at least one period of the lowest pitch
    this.d = new Float64Array(this.tauMax + 2);
    this.raw = new Float64Array(this.tauMax + 2);
  }

  /** Samples needed past a frame start to analyse it. */
  get span(): number {
    return this.w + this.tauMax + 1;
  }

  frame(x16: Float32Array, at: number): { hz: number; clarity: number; rms: number } {
    let e = 0;
    for (let j = 0; j < this.w; j++) e += x16[at + j]! * x16[at + j]!;
    const rms = Math.sqrt(e / this.w);
    if (rms < 1e-4) return { hz: 0, clarity: 0, rms };
    const r = yinFrame(x16, at, this.w, this.tauMin, this.tauMax, this.d, 0.12, this.raw);
    return { hz: r.clarity >= CLARITY_MIN ? r.hz : 0, clarity: r.clarity, rms };
  }
}

/** Tracks a whole recording at 100 fps (frame time = window center). */
export function trackPitch(x: Float32Array, rate: number, source: CaptureSource): PitchFrame[] {
  const x16 = resampleTo16k(x, rate);
  const tr = new PitchTracker(source);
  const out: PitchFrame[] = [];
  for (let at = 0; at + tr.span <= x16.length; at += HOP) {
    const f = tr.frame(x16, at);
    out.push({ t: (at + tr.w / 2) / TRACK_RATE, hz: f.hz, clarity: f.clarity, rms: f.rms });
  }
  return medianSmooth(out);
}

/** 5-frame median filter on voiced pitches (in MIDI); unvoiced frames stay unvoiced. */
export function medianSmooth(frames: PitchFrame[], k = 5): PitchFrame[] {
  const h = Math.floor(k / 2);
  const midi = frames.map((f) => (f.hz > 0 ? hzToMidi(f.hz) : NaN));
  return frames.map((f, i) => {
    if (f.hz <= 0) return f;
    const win: number[] = [];
    for (let j = Math.max(0, i - h); j <= Math.min(frames.length - 1, i + h); j++) if (!Number.isNaN(midi[j]!)) win.push(midi[j]!);
    win.sort((a, b) => a - b);
    const m = win[Math.floor(win.length / 2)]!;
    return { ...f, hz: midiToHz(m) };
  });
}
