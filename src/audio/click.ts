// Metronome / count-in click: short sine bursts (1.6 kHz accent, 1 kHz normal), ~25 ms.
// AUDIO THREAD CODE: no allocations after construction.
const POOL = 4;
const LEN_S = 0.025;
const TWO_PI = Math.PI * 2;

export class Clicks {
  private readonly phase = new Float64Array(POOL);
  private readonly inc = new Float64Array(POOL);
  private readonly amp = new Float64Array(POOL);
  private readonly left = new Int32Array(POOL);
  private readonly len: number;
  private next = 0;

  constructor(private readonly sr: number) {
    this.len = Math.round(LEN_S * sr);
  }

  trigger(accent: boolean, gain: number): void {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    this.phase[i] = 0;
    this.inc[i] = (TWO_PI * (accent ? 1600 : 1000)) / this.sr;
    this.amp[i] = gain * (accent ? 0.5 : 0.35);
    this.left[i] = this.len;
  }

  clear(): void {
    this.left.fill(0);
  }

  render(out: Float32Array, from: number, to: number): void {
    const len = this.len;
    for (let v = 0; v < POOL; v++) {
      let left = this.left[v]!;
      if (left <= 0) continue;
      let phase = this.phase[v]!;
      const inc = this.inc[v]!;
      const amp = this.amp[v]!;
      const end = Math.min(to, from + left);
      for (let i = from; i < end; i++) {
        const t = 1 - left / len; // 0..1 through the burst
        const env = Math.min(1, t * 40) * (1 - t) * (1 - t);
        out[i] = out[i]! + amp * env * Math.sin(phase);
        phase += inc;
        left--;
      }
      this.phase[v] = phase % TWO_PI;
      this.left[v] = left;
    }
  }
}
