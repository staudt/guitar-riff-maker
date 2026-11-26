// From pitch frames to notes (free timing), and from notes to the step grid.
import type { GridNote, GridSize, PitchFrame, RawNote } from './types';
import { hzToMidi } from './pitch';

const MIN_NOTE_S = 0.07; // shortest note kept
const JUMP_SEMIS = 0.7; // a sustained pitch change this big starts a new note
const JUMP_FRAMES = 4; // ...if it lasts this many frames (40 ms)
const DIP_DB = 4.5; // an energy dip this deep inside a voiced run splits notes (re-articulation, "da da")
const OCT_GLITCH = 5; // semitones: a 1-3 frame excursion this big that returns is a tracker slip

/** Median of an array (copy-sorted). */
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

/** Cleaned pitch line: NaN where unvoiced; octave slips folded back, tiny dropouts bridged, specks removed. */
export type CleanLine = { midi: number[]; db: number[]; rms: number[]; dt: number; maxRms: number };

export function cleanLine(frames: PitchFrame[]): CleanLine {
  const n = frames.length;
  const dt = n > 1 ? frames[1]!.t - frames[0]!.t : 0.01;
  const rms = frames.map((f) => f.rms);
  const maxRms = Math.max(...rms, 1e-9);
  const midi = frames.map((f) => (f.hz > 0 && f.rms > maxRms * 0.02 ? hzToMidi(f.hz) : NaN)); // ~-34 dB from the loudest
  const rdb = rms.map((r) => 20 * Math.log10(Math.max(r, 1e-9)));

  // 1. Octave slips: a short excursion (1-3 frames) away from a pitch that comes right back.
  for (let i = 1; i < n; i++) {
    const p = midi[i - 1]!;
    if (Number.isNaN(p) || Number.isNaN(midi[i]!) || Math.abs(midi[i]! - p) < OCT_GLITCH) continue;
    for (let j = i + 1; j <= Math.min(n - 1, i + 3); j++) {
      const q = midi[j]!;
      if (Number.isNaN(q) || Math.abs(q - p) >= 1.5) continue;
      let ok = true;
      for (let k = i; k < j; k++) if (!Number.isNaN(midi[k]!) && Math.abs(midi[k]! - p) < OCT_GLITCH) ok = false;
      if (!ok) break;
      for (let k = i; k < j; k++) {
        if (Number.isNaN(midi[k]!)) continue;
        const folded = midi[k]! - 12 * Math.round((midi[k]! - p) / 12);
        midi[k] = Math.abs(folded - p) < 1.5 ? folded : p + ((q - p) * (k - i + 1)) / (j - i + 1);
      }
      break;
    }
  }

  // 2. Bridge short unvoiced gaps (<= 3 frames) inside a note: same pitch both sides and no energy dip.
  for (let i = 1; i < n - 1; i++) {
    if (!Number.isNaN(midi[i]!) || Number.isNaN(midi[i - 1]!)) continue;
    let j = i;
    while (j < n && Number.isNaN(midi[j]!)) j++;
    if (j >= n || j - i > 3) { i = j; continue; }
    const a = midi[i - 1]!;
    const b = midi[j]!;
    let lo = Infinity;
    for (let k = i; k < j; k++) lo = Math.min(lo, rdb[k]!);
    const side = Math.min(rdb[i - 1]!, rdb[j]!);
    if (Math.abs(a - b) < JUMP_SEMIS && lo >= side - DIP_DB && rms[i]! > maxRms * 0.02) {
      for (let k = i; k < j; k++) midi[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }

  // 3. Specks: voiced runs under 3 frames are noise.
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(midi[i]!)) continue;
    let j = i;
    while (j < n && !Number.isNaN(midi[j]!)) j++;
    if (j - i < 3) for (let k = i; k < j; k++) midi[k] = NaN;
    i = j;
  }

  // Energy in dB, 3-frame mean (voiced frames only matter).
  const db = rdb.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) { s += rdb[k]!; c++; }
    return s / c;
  });
  return { midi, db, rms, dt, maxRms };
}

/** Pitch of a stretch of frames: the densest cluster (ignores onset glides and release drift). */
function modePitch(m: number[]): number {
  let best = m[0]!;
  let bestN = -1;
  for (const v of m) {
    let c = 0;
    for (const w of m) if (Math.abs(w - v) <= 0.3) c++;
    if (c >= bestN) { bestN = c; best = v; }
  }
  return median(m.filter((v) => Math.abs(v - best) <= 0.5));
}

type Piece = { a: number; b: number };

/**
 * Segments a monophonic pitch track into notes (free timing):
 * 1. clean the line (octave slips, dropouts), voiced runs separated by unvoiced frames,
 * 2. split runs at energy dips (re-articulation, "da da") even when the tracker never lost the pitch,
 * 3. split at sustained pitch changes (>= 0.7 semitone for 40 ms), keeping the glide with the new note,
 * 4. note pitch = the densest cluster of its frames (ignores glides, vibrato), min note 70 ms.
 */
export function segmentNotes(frames: PitchFrame[]): RawNote[] {
  if (frames.length < 2) return [];
  const { midi, db, dt, maxRms } = cleanLine(frames);
  const n = frames.length;
  const minFrames = Math.round(MIN_NOTE_S / dt);

  // Energy dips -> segments.
  const segs: Piece[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(midi[i]!)) continue;
    let j = i;
    while (j < n && !Number.isNaN(midi[j]!)) j++;
    for (const s of splitAtDips(i, j)) segs.push(s);
    i = j;
  }

  function splitAtDips(a: number, b: number): Piece[] {
    const out: Piece[] = [];
    let from = a;
    let i = a + 2;
    while (i < b - 2) {
      if (!(db[i]! < db[i - 1]! && db[i]! <= db[i + 1]!)) { i++; continue; }
      let left = -Infinity;
      for (let k = Math.max(from, i - 20); k < i; k++) left = Math.max(left, db[k]!);
      let right = -Infinity;
      for (let k = i + 1; k < Math.min(b, i + 21); k++) right = Math.max(right, db[k]!);
      const depth = Math.min(left, right) - db[i]!;
      if (depth < DIP_DB) { i++; continue; }
      const level = db[i]! + depth / 2;
      let f = i;
      while (f > from && db[f]! < level) f--;
      let r = i;
      while (r < b - 1 && db[r]! < level) r++;
      // Dip bottom -> a gap [f+1, r) between two notes.
      if (f + 1 > from) out.push({ a: from, b: f + 1 });
      from = r;
      i = r + 2;
    }
    if (from < b) out.push({ a: from, b });
    return out;
  }

  // Pitch changes -> pieces; a piece shorter than the minimum is an onset glide of the next one.
  const notes: RawNote[] = [];
  for (const seg of segs) {
    let pieces = splitAtPitch(seg.a, seg.b);
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k]!;
      if (p.b - p.a >= minFrames || pieces.length === 1) continue;
      const next = pieces[k + 1];
      if (next) { next.a = p.a; pieces.splice(k, 1); k--; }
      else if (k > 0) { pieces[k - 1]!.b = p.b; pieces.splice(k, 1); k--; }
    }
    // Re-merge neighbours that ended up on the same pitch (no dip between them by construction).
    const merged: { p: Piece; m: number }[] = [];
    for (const p of pieces) {
      const m = modePitch(midi.slice(p.a, p.b));
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.m - m) < JUMP_SEMIS) { prev.p.b = p.b; prev.m = modePitch(midi.slice(prev.p.a, prev.p.b)); }
      else merged.push({ p: { ...p }, m });
    }
    pieces = merged.map((x) => x.p);
    for (const p of pieces) {
      if (p.b - p.a < minFrames) continue;
      let peak = 0;
      for (let k = p.a; k < p.b; k++) peak = Math.max(peak, frames[k]!.rms);
      notes.push({
        start: frames[p.a]!.t - dt / 2,
        end: frames[p.b - 1]!.t + dt / 2,
        midi: modePitch(midi.slice(p.a, p.b)),
        velocity: Math.min(127, Math.round(60 + 67 * Math.min(1, peak / maxRms))),
      });
    }
  }
  return notes;

  function splitAtPitch(a: number, b: number): Piece[] {
    const cuts: number[] = [a];
    let start = a;
    let refStart = a;
    for (let i = a + 3; i < b; i++) {
      const hist = midi.slice(Math.max(refStart, i - 25), i);
      const ref = median(hist);
      const dev = midi[i]! - ref;
      if (Math.abs(dev) < JUMP_SEMIS) continue;
      // Vibrato swings around the note: a new note must sit outside everything this one just did.
      const lo = Math.min(...hist);
      const hi = Math.max(...hist);
      // Find the plateau the pitch settles on (a glide may take a few frames to get there).
      let plateau = -1;
      for (let s = i; s <= Math.min(i + 8, b - JUMP_FRAMES); s++) {
        const w = midi.slice(s, s + JUMP_FRAMES);
        if (Math.max(...w) - Math.min(...w) > 1.0) continue;
        const wm = median(w);
        if (Math.abs(wm - ref) >= JUMP_SEMIS && Math.sign(wm - ref) === Math.sign(dev) && (wm > hi + 0.15 || wm < lo - 0.15)) { plateau = s; break; }
      }
      if (plateau < 0 || i - start < 3) continue;
      cuts.push(i);
      start = i;
      refStart = plateau;
      i = plateau + JUMP_FRAMES - 1;
    }
    cuts.push(b);
    const out: Piece[] = [];
    for (let k = 0; k + 1 < cuts.length; k++) out.push({ a: cuts[k]!, b: cuts[k + 1]! });
    return out;
  }
}

/**
 * Quantizes notes (seconds from bar 0) to a 1/8 or 1/16 grid at `bpm`, keeping them monophonic:
 * overlapping notes are cut at the next onset, and two notes landing on one step keep the longer.
 */
export function quantize(notes: RawNote[], bpm: number, grid: GridSize, totalSteps: number): GridNote[] {
  const stepS = 60 / bpm / 4;
  const g = grid === 8 ? 2 : 1;
  const q = (t: number) => Math.round(t / stepS / g) * g;
  const byStep = new Map<number, GridNote & { dur: number }>();
  for (const n of notes) {
    const step = q(n.start);
    if (step < 0 || step >= totalSteps) continue;
    const length = Math.max(g, q(n.end) - step);
    const cand = { step, length, midi: Math.round(n.midi), velocity: n.velocity, dur: n.end - n.start };
    const prev = byStep.get(step);
    if (!prev || cand.dur > prev.dur) byStep.set(step, cand);
  }
  const out = [...byStep.values()].sort((a, b) => a.step - b.step);
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    const end = Math.min(next ? next.step : totalSteps, out[i]!.step + out[i]!.length);
    out[i]!.length = Math.max(1, end - out[i]!.step);
  }
  return out.map(({ dur: _d, ...n }) => n);
}
