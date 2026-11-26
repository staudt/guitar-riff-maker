// Riff Maker engine core: sample-accurate transport (count-in, A-B loop, tempo re-anchoring),
// plucked / guide voices, metronome clicks, tone bus and master limiter.
// Pure TypeScript with no Web Audio dependency, so it renders offline in Node for tests.
// AUDIO THREAD CODE: process() allocates nothing. Commands may allocate (they run at UI rate, between blocks).
// Clock design adapted from tko's engine: anchorFrame/anchorStep/samplesPerStep with posAt/frameAt.
import type { Cmd, Evt, InstrumentKind, PNote } from './protocol';
import { Bus } from './bus';
import { Clicks } from './click';
import { PluckVoice } from './voices/pluck';
import { GuideVoice } from './voices/guide';

const PLUCK_VOICES = 8;
const GUIDE_VOICES = 4;
const MAX_OFFS = 64;
const EVENT_RING = 4096;
const MAX_MIDIS = 3;
const FRAME_EPS = 1e-6;

const EV_STEP = 0;
const EV_NOTE = 1;
const EV_STOPPED = 2;

const OFF_STEP = 0; // t is a step in the transport timeline
const OFF_FRAME = 1; // t is an absolute frame

const ceilF = (x: number) => Math.ceil(x - FRAME_EPS);

export class Engine {
  private readonly sr: number;
  // Tempo / clock.
  private bpm = 120;
  private rate = 1;
  private sps: number; // samples per 16th step
  private anchorFrame = 0;
  private anchorStep = 0;
  private nextFrame = 0;
  private synced = false;
  // Transport.
  private playing = false;
  private pendingStart = false;
  private counting = false;
  private from = 0;
  private countStart = 0;
  private cursor = 0; // next step to fire
  private loopStart = 0; // as commanded (end <= start = whole riff)
  private loopEnd = 0;
  private rangeStart = 0; // effective
  private rangeEnd = 1;
  private metOn = false;
  private metGain = 0.7;
  // Riff.
  private total = 0;
  private nNotes = 0;
  private noteStep = new Int32Array(0);
  private noteLen = new Int32Array(0);
  private noteVel = new Float32Array(0);
  private noteCnt = new Uint8Array(0);
  private noteMidi = new Int16Array(0);
  private noteIdx = new Int32Array(0);
  private noteNext = new Int32Array(0);
  private head = new Int32Array(0);
  // Voices.
  private kind: InstrumentKind = 'clean';
  private readonly pluck: PluckVoice[] = [];
  private readonly guide: GuideVoice[] = [];
  private serialCtr = 0;
  private readonly clicks: Clicks;
  private readonly bus: Bus;
  // Pending note-offs.
  private offN = 0;
  private readonly offKind = new Uint8Array(MAX_OFFS);
  private readonly offT = new Float64Array(MAX_OFFS);
  private readonly offGuide = new Uint8Array(MAX_OFFS);
  private readonly offVoice = new Int16Array(MAX_OFFS);
  private readonly offSerial = new Int32Array(MAX_OFFS);
  // Event ring.
  private readonly evType = new Uint8Array(EVENT_RING);
  private readonly evA = new Int32Array(EVENT_RING);
  private readonly evTime = new Float64Array(EVENT_RING);
  private evR = 0;
  private evW = 0;
  // Scratch.
  private mix = new Float32Array(4096);
  private clk = new Float32Array(4096);

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.sps = this.computeSps();
    for (let i = 0; i < PLUCK_VOICES; i++) this.pluck.push(new PluckVoice(sampleRate, 0x9e3779b1 + i * 7919));
    for (let i = 0; i < GUIDE_VOICES; i++) this.guide.push(new GuideVoice(sampleRate));
    this.clicks = new Clicks(sampleRate);
    this.bus = new Bus(sampleRate);
    this.updateRange();
  }

  // ---- clock ----

  private computeSps(): number {
    return (this.sr * 60) / (this.bpm * this.rate) / 4;
  }
  private posAt(frame: number): number {
    return this.anchorStep + (frame - this.anchorFrame) / this.sps;
  }
  private frameAt(step: number): number {
    return this.anchorFrame + (step - this.anchorStep) * this.sps;
  }

  private updateRange(): void {
    const whole = !(this.loopEnd > this.loopStart);
    const s = whole ? 0 : this.loopStart;
    let e = whole ? this.total : Math.min(this.loopEnd, this.total);
    if (e <= s) e = s + 1;
    this.rangeStart = s;
    this.rangeEnd = e;
  }

  /** After the range changed mid-play: a cursor past the end jumps to the start (re-anchored at the block boundary). */
  private fixCursor(): void {
    if (!this.playing || this.pendingStart || this.counting) return;
    if (this.cursor >= this.rangeEnd || this.cursor < this.rangeStart) {
      this.releaseStepOffs();
      this.anchorFrame = this.nextFrame;
      this.anchorStep = this.rangeStart;
      this.cursor = this.rangeStart;
    }
  }

  // ---- commands (UI rate) ----

  command(cmd: Cmd): void {
    switch (cmd.type) {
      case 'riff':
        this.setRiff(cmd.notes, cmd.totalSteps);
        this.updateRange();
        this.fixCursor();
        break;
      case 'tempo': {
        const bpm = Math.max(20, Math.min(400, cmd.bpm));
        const rate = Math.max(0.1, Math.min(2, cmd.rate));
        if (this.playing && !this.pendingStart) {
          const pos = this.posAt(this.nextFrame);
          this.anchorStep = pos;
          this.anchorFrame = this.nextFrame;
        }
        this.bpm = bpm;
        this.rate = rate;
        this.sps = this.computeSps();
        break;
      }
      case 'loop':
        this.loopStart = Math.max(0, Math.round(cmd.start));
        this.loopEnd = Math.max(0, Math.round(cmd.end));
        this.updateRange();
        this.fixCursor();
        break;
      case 'play': {
        this.releaseAll();
        const ci = cmd.countInBeats;
        this.from = Math.max(0, Math.min(Math.round(cmd.from), Math.max(0, this.total - 1)));
        this.countStart = this.from - ci * 4;
        this.counting = ci > 0;
        this.cursor = this.countStart;
        this.anchorStep = this.countStart;
        this.anchorFrame = this.nextFrame;
        this.playing = true;
        this.pendingStart = true;
        break;
      }
      case 'stop':
        this.stopTransport();
        break;
      case 'metronome':
        this.metOn = cmd.on;
        this.metGain = Math.max(0, Math.min(2, cmd.gain));
        break;
      case 'instrument':
        this.kind = cmd.kind;
        this.bus.drive = cmd.kind === 'drive';
        break;
      case 'audition': {
        const t = this.nextFrame + Math.max(0.02, cmd.seconds) * this.sr;
        for (let i = 0; i < cmd.midis.length && i < MAX_MIDIS; i++) this.startVoice(cmd.midis[i]!, cmd.vel, OFF_FRAME, t);
        break;
      }
      case 'volume':
        this.bus.setVolume(cmd.gain);
        break;
      case 'panic':
        this.stopTransport();
        for (const v of this.pluck) v.kill();
        for (const v of this.guide) v.kill();
        this.clicks.clear();
        this.offN = 0;
        break;
    }
  }

  private setRiff(notes: PNote[], totalSteps: number): void {
    const total = Math.max(0, Math.round(totalSteps));
    let n = 0;
    for (const p of notes) if (p.step >= 0 && p.step < total && p.midis.length > 0) n++;
    this.noteStep = new Int32Array(n);
    this.noteLen = new Int32Array(n);
    this.noteVel = new Float32Array(n);
    this.noteCnt = new Uint8Array(n);
    this.noteMidi = new Int16Array(n * MAX_MIDIS);
    this.noteIdx = new Int32Array(n);
    this.noteNext = new Int32Array(n).fill(-1);
    this.head = new Int32Array(total).fill(-1);
    const tail = new Int32Array(total).fill(-1);
    let k = 0;
    for (const p of notes) {
      if (!(p.step >= 0 && p.step < total && p.midis.length > 0)) continue;
      this.noteStep[k] = p.step;
      this.noteLen[k] = Math.max(1, Math.round(p.length));
      this.noteVel[k] = p.vel;
      this.noteCnt[k] = Math.min(MAX_MIDIS, p.midis.length);
      for (let m = 0; m < this.noteCnt[k]!; m++) this.noteMidi[k * MAX_MIDIS + m] = p.midis[m]!;
      this.noteIdx[k] = p.index;
      const s = p.step;
      if (tail[s]! < 0) this.head[s] = k;
      else this.noteNext[tail[s]!] = k;
      tail[s] = k;
      k++;
    }
    this.nNotes = n;
    this.total = total;
  }

  private stopTransport(): void {
    const was = this.playing;
    this.playing = false;
    this.pendingStart = false;
    this.counting = false;
    this.releaseAll();
    this.offN = 0;
    if (was) this.emit(EV_STOPPED, 0, this.nextFrame / this.sr);
  }

  private releaseAll(): void {
    for (const v of this.pluck) if (v.active) v.release();
    for (const v of this.guide) if (v.active) v.release();
  }

  // ---- events ----

  private emit(type: number, a: number, time: number): void {
    const w = this.evW;
    const next = (w + 1) % EVENT_RING;
    if (next === this.evR) return; // full: drop
    this.evType[w] = type;
    this.evA[w] = a;
    this.evTime[w] = time;
    this.evW = next;
  }

  /** Hands queued events to cb in order (allocates one object per event; call outside the render path's hot loop). */
  drainEvents(cb: (e: Evt) => void): void {
    while (this.evR !== this.evW) {
      const r = this.evR;
      const t = this.evType[r]!;
      const a = this.evA[r]!;
      const time = this.evTime[r]!;
      this.evR = (r + 1) % EVENT_RING;
      if (t === EV_STEP) cb({ type: 'step', step: a, time });
      else if (t === EV_NOTE) cb({ type: 'note', index: a, time });
      else cb({ type: 'stopped' });
    }
  }

  // ---- voices ----

  private startVoice(midi: number, vel: number, offKind: number, offT: number): void {
    const serial = ++this.serialCtr;
    let idx = -1;
    let isGuide = 0;
    if (this.kind === 'guide') {
      isGuide = 1;
      let oldest = Infinity;
      for (let i = 0; i < GUIDE_VOICES; i++) {
        const v = this.guide[i]!;
        if (!v.active) {
          idx = i;
          break;
        }
        if (v.serial < oldest) {
          oldest = v.serial;
          idx = i;
        }
      }
      this.guide[idx]!.start(midi, vel, serial);
    } else {
      let oldest = Infinity;
      for (let i = 0; i < PLUCK_VOICES; i++) {
        const v = this.pluck[i]!;
        if (!v.active) {
          idx = i;
          break;
        }
        if (v.serial < oldest) {
          oldest = v.serial;
          idx = i;
        }
      }
      this.pluck[idx]!.start(midi, vel, serial);
    }
    if (this.offN < MAX_OFFS) {
      const o = this.offN++;
      this.offKind[o] = offKind;
      this.offT[o] = offT;
      this.offGuide[o] = isGuide;
      this.offVoice[o] = idx;
      this.offSerial[o] = serial;
    }
  }

  private fireOff(o: number): void {
    const idx = this.offVoice[o]!;
    if (this.offGuide[o]) {
      const v = this.guide[idx]!;
      if (v.active && v.serial === this.offSerial[o]) v.release();
    } else {
      const v = this.pluck[idx]!;
      if (v.active && v.serial === this.offSerial[o]) v.release();
    }
    const last = --this.offN;
    if (o !== last) {
      this.offKind[o] = this.offKind[last]!;
      this.offT[o] = this.offT[last]!;
      this.offGuide[o] = this.offGuide[last]!;
      this.offVoice[o] = this.offVoice[last]!;
      this.offSerial[o] = this.offSerial[last]!;
    }
  }

  /** Releases voices with step-timed offs and drops those entries (transport jumped). */
  private releaseStepOffs(): void {
    for (let o = this.offN - 1; o >= 0; o--) if (this.offKind[o] === OFF_STEP) this.fireOff(o);
  }

  // ---- render ----

  /** Renders one block. frame0 = absolute context frame of outL[0]. */
  process(outL: Float32Array, outR: Float32Array, frame0: number): void {
    const n = outL.length;
    if (n > this.mix.length) {
      this.mix = new Float32Array(n);
      this.clk = new Float32Array(n);
    }
    if (!this.synced) {
      // Commands queued before the first block (audition) used frame 0 as "now".
      const shift = frame0 - this.nextFrame;
      for (let o = 0; o < this.offN; o++) if (this.offKind[o] === OFF_FRAME) this.offT[o] = this.offT[o]! + shift;
      this.synced = true;
    }
    this.nextFrame = frame0;
    if (this.pendingStart) {
      this.anchorFrame = frame0;
      this.pendingStart = false;
    }
    const mix = this.mix;
    const clk = this.clk;
    mix.fill(0, 0, n);
    clk.fill(0, 0, n);
    const end = frame0 + n;
    let pos = frame0;
    for (;;) {
      // Next note-off.
      let offF = Infinity;
      let offIdx = -1;
      for (let o = 0; o < this.offN; o++) {
        const f = this.offKind[o] === OFF_STEP ? ceilF(this.frameAt(this.offT[o]!)) : Math.ceil(this.offT[o]!);
        if (f < offF) {
          offF = f;
          offIdx = o;
        }
      }
      const stepF = this.playing ? ceilF(this.frameAt(this.cursor)) : Infinity;
      let evF: number;
      let isOff: boolean;
      if (offIdx >= 0 && offF <= stepF) {
        evF = offF;
        isOff = true;
      } else {
        evF = stepF;
        isOff = false;
      }
      if (!(evF < end)) break;
      if (evF < pos) evF = pos;
      if (evF > pos) this.renderSegment(pos - frame0, evF - frame0);
      pos = evF;
      if (isOff) this.fireOff(offIdx);
      else this.fireStep(evF);
    }
    this.renderSegment(pos - frame0, n);
    this.bus.process(mix, clk, outL, outR, n);
    this.nextFrame = end;
  }

  private renderSegment(from: number, to: number): void {
    if (to <= from) return;
    for (let i = 0; i < PLUCK_VOICES; i++) this.pluck[i]!.render(this.mix, from, to);
    for (let i = 0; i < GUIDE_VOICES; i++) this.guide[i]!.render(this.mix, from, to);
    this.clicks.render(this.clk, from, to);
  }

  private fireStep(frame: number): void {
    const c = this.cursor;
    const time = frame / this.sr;
    if (this.counting && c < this.from) {
      const rel = c - this.countStart;
      if (rel % 4 === 0) {
        this.clicks.trigger(rel === 0, Math.max(this.metGain, 0.5));
        this.emit(EV_STEP, c - this.from, time);
      }
    } else {
      this.counting = false;
      this.emit(EV_STEP, c, time);
      if (this.metOn && c % 4 === 0) this.clicks.trigger(c % 16 === 0, this.metGain);
      if (c >= 0 && c < this.total) {
        for (let k = this.head[c]!; k >= 0; k = this.noteNext[k]!) {
          this.emit(EV_NOTE, this.noteIdx[k]!, time);
          const cnt = this.noteCnt[k]!;
          for (let m = 0; m < cnt; m++) this.startVoice(this.noteMidi[k * MAX_MIDIS + m]!, this.noteVel[k]!, OFF_STEP, c + this.noteLen[k]!);
        }
      }
    }
    this.cursor = c + 1;
    if (this.cursor >= this.rangeEnd && !this.counting) this.wrap();
  }

  /** Sample-exact loop wrap: the end boundary becomes the start boundary on the same frame. */
  private wrap(): void {
    const s = this.rangeStart;
    const e = this.rangeEnd;
    this.anchorFrame += (e - this.anchorStep) * this.sps;
    this.anchorStep = s;
    this.cursor = s;
    const d = e - s;
    for (let o = 0; o < this.offN; o++) if (this.offKind[o] === OFF_STEP) this.offT[o] = this.offT[o]! - d;
  }
}
