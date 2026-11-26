// Plucked-string voice: real-time Karplus-Strong, ported from tko's renderFingerBass.
// Unlike the offline original (integer delay, filter delay ignored: ~25 cents flat on high notes),
// the loop is tuned exactly: total loop delay = N + lowpass phase delay + allpass phase delay = sr / f0,
// using a first-order Thiran allpass for the fractional part.
// AUDIO THREAD CODE: no allocations after construction.
import { midiHz, Noise } from '../dsp';

const DAMP = 0.3; // 0 = no loop damping, 0.5 = strong
const T60_LOW = 2.0; // seconds at midi 40
const T60_HIGH = 1.0; // seconds at midi 88

export class PluckVoice {
  active = false;
  serial = 0;
  private readonly buf: Float64Array;
  private readonly tmp: Float64Array;
  private readonly noise: Noise;
  private n = 1;
  private pos = 0;
  private prev = 0;
  private damp = DAMP;
  private gain = 0.99;
  private c = 0;
  private apX = 0;
  private apY = 0;
  private relPass = 1; // extra per-pass gain once released
  private rel = 1;
  private env = 0;
  private age = 0;
  private maxAge = 0;

  constructor(private readonly sr: number, seed: number) {
    const max = Math.ceil(sr / 30) + 4;
    this.buf = new Float64Array(max);
    this.tmp = new Float64Array(max);
    this.noise = new Noise(seed);
  }

  start(midi: number, vel: number, serial: number): void {
    const sr = this.sr;
    const f0 = midiHz(midi);
    const w0 = (2 * Math.PI * f0) / sr;
    const damp = DAMP;
    // Phase delay of the two-tap loop filter (1-damp) + damp*z^-1 at f0 (-> damp at DC).
    const re = 1 - damp + damp * Math.cos(w0);
    const im = damp * Math.sin(w0);
    const lpDelay = Math.atan2(im, re) / w0;
    const lpMag = Math.hypot(re, im);
    const period = sr / f0;
    let n = Math.floor(period - lpDelay - 0.1);
    n = Math.max(2, Math.min(n, this.buf.length));
    let d = period - lpDelay - n;
    d = Math.max(0.1, Math.min(d, 1.5));
    this.n = n;
    this.damp = damp;
    this.c = (1 - d) / (1 + d);
    // Loop gain for a roughly constant T60 per pitch (compensating the filter's loss at f0).
    const k = Math.max(0, Math.min(1, (midi - 40) / 48));
    const t60 = T60_LOW + (T60_HIGH - T60_LOW) * k;
    this.gain = Math.min(0.9995, Math.pow(10, -3 / (t60 * f0)) / lpMag);
    this.relPass = Math.pow(10, -3 / (0.03 * f0));
    this.rel = 1;
    this.maxAge = Math.ceil(sr * t60 * 1.5);
    this.age = 0;
    this.env = 1;
    this.prev = 0;
    this.apX = 0;
    this.apY = 0;
    this.pos = 0;
    this.serial = serial;
    this.excite(Math.max(0, Math.min(1, vel / 127)));
    this.active = true;
  }

  // Noise -> one-pole lowpass (brighter when harder) -> pick-position comb -> DC removal -> normalise.
  private excite(v: number): void {
    const n = this.n;
    const buf = this.buf;
    const tmp = this.tmp;
    const a = 0.25 + 0.5 * v;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += a * (this.noise.next() - lp);
      tmp[i] = lp;
    }
    const pick = Math.max(1, Math.round(n / 5));
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const x = tmp[i]! - 0.7 * tmp[(i + pick) % n]!;
      buf[i] = x;
      mean += x;
    }
    mean /= n;
    let pk = 1e-9;
    for (let i = 0; i < n; i++) {
      buf[i] = buf[i]! - mean;
      pk = Math.max(pk, Math.abs(buf[i]!));
    }
    const amp = (0.12 + 0.3 * v) / pk;
    for (let i = 0; i < n; i++) buf[i] = buf[i]! * amp;
  }

  release(): void {
    this.rel = this.relPass;
  }

  kill(): void {
    this.active = false;
  }

  /** Adds samples [from, to) into out. */
  render(out: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    const buf = this.buf;
    const n = this.n;
    const damp = this.damp;
    const g = this.gain * this.rel;
    const c = this.c;
    let pos = this.pos;
    let prev = this.prev;
    let apX = this.apX;
    let apY = this.apY;
    let env = this.env;
    for (let i = from; i < to; i++) {
      const cur = buf[pos]!;
      const lp = g * ((1 - damp) * cur + damp * prev);
      prev = cur;
      const y = c * lp + apX - c * apY;
      apX = lp;
      apY = y;
      buf[pos] = y;
      pos = pos + 1 === n ? 0 : pos + 1;
      out[i] = out[i]! + cur;
      const a = cur < 0 ? -cur : cur;
      env = a > env ? a : env * 0.9995;
    }
    this.age += to - from;
    this.pos = pos;
    this.prev = prev;
    this.apX = Math.abs(apX) < 1e-18 ? 0 : apX;
    this.apY = Math.abs(apY) < 1e-18 ? 0 : apY;
    this.env = env;
    if (env < 1e-5 || this.age > this.maxAge || !(env < 1e6)) this.active = false;
  }
}
