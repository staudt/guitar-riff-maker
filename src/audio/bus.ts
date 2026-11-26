// Output bus: instrument tone (clean lowpass or driven amp + cab), clicks, smoothed volume, master limiter.
// AUDIO THREAD CODE: no allocations after construction.
import { Svf, softClip } from './dsp';
import { Limiter } from './limiter';

const DRIVE_PRE = 3;
const DRIVE_MAKEUP = 1.6;

export class Bus {
  drive = false;
  private target = 0.9;
  private gain = 0.9;
  private readonly smooth: number;
  private readonly lp = new Svf();
  private readonly hp = new Svf();
  private readonly bp = new Svf();
  private readonly cabLp = new Svf();
  private readonly notch = new Svf();
  private readonly limiter: Limiter;

  constructor(sr: number) {
    this.smooth = 1 - Math.exp(-1 / (0.01 * sr));
    this.limiter = new Limiter(sr, 0.5);
    this.lp.set(6000, 0.707, sr);
    this.hp.set(90, 0.707, sr);
    this.bp.set(1600, 0.8, sr);
    this.cabLp.set(4200, 0.707, sr);
    this.notch.set(6000, 2, sr);
  }

  setVolume(g: number): void {
    this.target = Math.max(0, Math.min(2, g)) * 0.9;
  }

  /** Mixes instrument `inst` (tone-shaped) and `clk` (dry) to stereo `l`/`r` over n samples. */
  process(inst: Float32Array, clk: Float32Array, l: Float32Array, r: Float32Array, n: number): void {
    const drive = this.drive;
    const lp = this.lp;
    const hp = this.hp;
    const bp = this.bp;
    const cabLp = this.cabLp;
    const notch = this.notch;
    let gain = this.gain;
    for (let i = 0; i < n; i++) {
      const x = inst[i]!;
      let y: number;
      if (drive) {
        hp.tick(x);
        let s = softClip(hp.high * DRIVE_PRE, 0.8);
        s = softClip(s, 0.8);
        bp.tick(s);
        cabLp.tick(s);
        notch.tick(0.75 * cabLp.low + 0.6 * bp.band);
        y = (notch.low + notch.high) * DRIVE_MAKEUP;
      } else {
        lp.tick(x);
        y = lp.low;
      }
      gain += (this.target - gain) * this.smooth;
      const o = (y + clk[i]!) * gain;
      l[i] = o;
      r[i] = o;
    }
    this.gain = gain;
    lp.flush();
    hp.flush();
    bp.flush();
    cabLp.flush();
    notch.flush();
    this.limiter.process(l, r, n);
  }
}
