// Guide tone: sine carrier with one FM modulator (ratio 1), the clearest sound for slow practice.
// AUDIO THREAD CODE: no allocations after construction.
import { midiHz } from '../dsp';

const TWO_PI = Math.PI * 2;
const ATTACK_S = 0.005;
const RELEASE_S = 0.08;
const INDEX_START = 1.5;
const INDEX_END = 0.3;
const INDEX_TAU_S = 0.25;
const MAX_HELD_S = 12;

export class GuideVoice {
  active = false;
  serial = 0;
  private phase = 0;
  private inc = 0;
  private amp = 0;
  private level = 0;
  private readonly attackInc: number;
  private readonly releaseInc: number;
  private releasing = false;
  private index = INDEX_START;
  private readonly indexK: number;
  private life = 0;
  private readonly maxLife: number;

  constructor(private readonly sr: number) {
    this.attackInc = 1 / (ATTACK_S * sr);
    this.releaseInc = 1 / (RELEASE_S * sr);
    this.indexK = 1 - Math.exp(-1 / (INDEX_TAU_S * sr));
    this.maxLife = MAX_HELD_S * sr;
  }

  start(midi: number, vel: number, serial: number): void {
    this.inc = (TWO_PI * midiHz(midi)) / this.sr;
    this.phase = 0;
    this.amp = 0.12 + 0.28 * Math.max(0, Math.min(1, vel / 127));
    this.level = 0;
    this.releasing = false;
    this.index = INDEX_START;
    this.life = 0;
    this.serial = serial;
    this.active = true;
  }

  release(): void {
    this.releasing = true;
  }

  kill(): void {
    this.active = false;
  }

  render(out: Float32Array, from: number, to: number): void {
    if (!this.active) return;
    let phase = this.phase;
    let level = this.level;
    let index = this.index;
    const inc = this.inc;
    for (let i = from; i < to; i++) {
      if (this.releasing) {
        level -= this.releaseInc;
        if (level <= 0) {
          this.active = false;
          break;
        }
      } else if (level < 1) {
        level += this.attackInc;
        if (level > 1) level = 1;
      }
      index += (INDEX_END - index) * this.indexK;
      out[i] = out[i]! + this.amp * level * Math.sin(phase + index * Math.sin(phase));
      phase += inc;
      if (phase >= TWO_PI) phase -= TWO_PI;
    }
    this.phase = phase;
    this.level = level;
    this.index = index;
    this.life += to - from;
    if (this.life > this.maxLife) this.active = false;
  }
}
