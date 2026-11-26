// Streaming live pitch tracker: raw mic chunks in (any sample rate), PitchFrames out at 100 fps.
// Pure (no DOM); runs inside trackerWorker.ts and in unit tests.
import { PitchTracker, TRACK_RATE, hzToMidi, midiToHz, resample } from './pitch';
import type { CaptureSource, PitchFrame } from './types';

const HOP = 160; // 100 fps at 16 kHz
const MEDIAN = 5;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function grow(buf: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  if (need <= buf.length) return buf;
  const out = new Float32Array(Math.max(need, buf.length * 2));
  out.set(buf);
  return out;
}

export class LiveTracker {
  private readonly tracker: PitchTracker;
  private raw = new Float32Array(1 << 16);
  private rawLen = 0;
  private x16 = new Float32Array(1 << 14);
  private outDone = 0; // 16 kHz samples produced
  private nextAt = 0; // start of the next analysis frame (16 kHz samples)
  private readonly pRaw: number; // raw samples per alignment period
  private readonly pOut: number; // 16 kHz samples per alignment period
  private readonly hist: number[] = [];

  constructor(readonly rate: number, source: CaptureSource) {
    this.tracker = new PitchTracker(source);
    const g = gcd(Math.round(rate), TRACK_RATE);
    this.pRaw = Math.round(rate) / g;
    this.pOut = TRACK_RATE / g;
  }

  /** Feeds a chunk of mono audio; returns the frames that became available (t = window centre, s from the first sample). */
  push(chunk: Float32Array): PitchFrame[] {
    this.raw = grow(this.raw, this.rawLen + chunk.length);
    this.raw.set(chunk, this.rawLen);
    this.rawLen += chunk.length;
    this.advanceResampler();
    const out: PitchFrame[] = [];
    const tr = this.tracker;
    while (this.nextAt + tr.span <= this.outDone) {
      const f = tr.frame(this.x16, this.nextAt);
      out.push(this.smooth({ t: (this.nextAt + tr.w / 2) / TRACK_RATE, hz: f.hz, clarity: f.clarity, rms: f.rms }));
      this.nextAt += HOP;
    }
    return out;
  }

  /** Resamples what is new, in windows aligned to whole alignment periods so the phase never drifts. */
  private advanceResampler(): void {
    if (this.rate === TRACK_RATE) {
      this.x16 = grow(this.x16, this.rawLen);
      this.x16.set(this.raw.subarray(this.outDone, this.rawLen), this.outDone);
      this.outDone = this.rawLen;
      return;
    }
    const ratio = this.rate / TRACK_RATE;
    const marginOut = Math.ceil(24 / this.pOut) * this.pOut;
    const startOut = Math.max(0, this.outDone - marginOut);
    const startRaw = (startOut / this.pOut) * this.pRaw;
    const win = this.raw.subarray(startRaw, this.rawLen);
    // The last outputs see a truncated kernel; leave them for the next chunk.
    const valid = Math.floor(win.length / ratio) - 12;
    let endOut = startOut + valid; // snapped down to a whole period below
    endOut = Math.floor(endOut / this.pOut) * this.pOut;
    if (endOut <= this.outDone) return;
    const r = resample(win, this.rate, TRACK_RATE);
    this.x16 = grow(this.x16, endOut);
    this.x16.set(r.subarray(this.outDone - startOut, endOut - startOut), this.outDone);
    this.outDone = endOut;
  }

  /** Causal median of the last 5 voiced pitches (in MIDI) so a single octave slip does not flicker the readout. */
  private smooth(f: PitchFrame): PitchFrame {
    this.hist.push(f.hz > 0 ? hzToMidi(f.hz) : NaN);
    if (this.hist.length > MEDIAN) this.hist.shift();
    if (f.hz <= 0) return f;
    const v = this.hist.filter((m) => !Number.isNaN(m)).sort((a, b) => a - b);
    return { ...f, hz: midiToHz(v[Math.floor(v.length / 2)]!) };
  }
}
