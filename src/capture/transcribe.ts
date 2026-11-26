// Final transcription after Stop: Spotify Basic Pitch (TF.js) on the recording, in every mode;
// the live tracker (YIN + segmentation) is the fallback when the model can't run.
// The model and TF.js are loaded lazily (first capture) and cached by the service worker.
import type { CaptureSource, RawNote, Transcription } from './types';
import { SOURCE_RANGE, resample, trackPitch } from './pitch';
import { segmentNotes } from './notes';

export const MODEL_RATE = 22050;

/** The model as raw files (model.json + weights), so the browser and Node load it the same way. */
export type ModelFiles = { json: ModelJson; weights: ArrayBuffer };
type ModelJson = {
  format: string;
  generatedBy: string;
  convertedBy: string;
  modelTopology: unknown;
  signature?: unknown;
  weightsManifest: { paths: string[]; weights: unknown[] }[];
};

/** Browser: fetch the bundled model files (hashed asset URLs, precached for offline use). */
export async function bundledModelFiles(): Promise<ModelFiles> {
  const [{ default: jsonUrl }, { default: binUrl }] = await Promise.all([
    import('@spotify/basic-pitch/model/model.json?url'),
    import('@spotify/basic-pitch/model/group1-shard1of1.bin?url'),
  ]);
  const [json, weights] = await Promise.all([fetch(jsonUrl).then((r) => r.json() as Promise<ModelJson>), fetch(binUrl).then((r) => r.arrayBuffer())]);
  return { json, weights };
}

type NoteOut = { startTimeSeconds: number; durationSeconds: number; pitchMidi: number; amplitude: number };

/** Per-source thresholds for turning the model's activations into notes. */
const PARAMS: Record<CaptureSource, { onset: number; frame: number; minLenFrames: number }> = {
  voice: { onset: 0.4, frame: 0.25, minLenFrames: 7 },
  whistle: { onset: 0.45, frame: 0.3, minLenFrames: 7 },
  guitar: { onset: 0.5, frame: 0.3, minLenFrames: 6 },
  chords: { onset: 0.5, frame: 0.3, minLenFrames: 8 },
};

let modelCache: { files: ModelFiles; model: Promise<unknown> } | null = null;

/** Runs Basic Pitch on mono audio at any rate. Returns note events in seconds. */
export async function runBasicPitch(audio: Float32Array, rate: number, source: CaptureSource, files: ModelFiles, onProgress?: (p: number) => void): Promise<NoteOut[]> {
  const tf = await import('@tensorflow/tfjs');
  const bp = await import('@spotify/basic-pitch');
  if (!modelCache || modelCache.files !== files) {
    const { json, weights } = files;
    const artifacts = {
      modelTopology: json.modelTopology as object,
      weightSpecs: json.weightsManifest.flatMap((g) => g.weights) as never,
      weightData: weights,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
      ...(json.signature ? { signature: json.signature as object } : {}),
    };
    modelCache = { files, model: tf.loadGraphModel(tf.io.fromMemory(artifacts)) };
  }
  const basicPitch = new bp.BasicPitch(modelCache.model as Promise<import('@tensorflow/tfjs').GraphModel>);
  const x = resample(audio, rate, MODEL_RATE);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await basicPitch.evaluateModel(
    x,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );
  const prm = PARAMS[source];
  const [lo, hi] = SOURCE_RANGE[source];
  const events = bp.outputToNotesPoly(frames, onsets, prm.onset, prm.frame, prm.minLenFrames, true, hi * 1.05, lo * 0.95, true);
  return bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, events));
}

/**
 * Keeps one note at a time for monophonic sources: notes starting within 40 ms of each other are
 * the same onset (keep the louder; drops octave/harmonic ghosts), otherwise a new note cuts the old.
 */
export function toMonophonic(notes: RawNote[]): RawNote[] {
  const sorted = notes.slice().sort((a, b) => a.start - b.start || b.velocity - a.velocity);
  const out: RawNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && n.start - prev.start < 0.04) {
      if (n.velocity > prev.velocity) out[out.length - 1] = n;
      continue;
    }
    if (prev && prev.end > n.start) prev.end = n.start;
    out.push({ ...n });
  }
  return out.filter((n) => n.end - n.start >= 0.08);
}

/** RMS envelope in dB, 10 ms hop, 20 ms window. */
function envelopeDb(audio: Float32Array, rate: number): { db: Float32Array; hop: number } {
  const hop = Math.round(rate * 0.01);
  const win = hop * 2;
  const n = Math.max(0, Math.floor((audio.length - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < win; j++) {
      const v = audio[i * hop + j]!;
      e += v * v;
    }
    db[i] = 10 * Math.log10(e / win + 1e-12);
  }
  return { db, hop };
}

/**
 * Cleans up Basic Pitch's monophonic output for sung, hummed and whistled notes:
 * - vibrato makes the model re-trigger, splitting one held note into same-pitch pieces: neighbours
 *   within a semitone that touch (gap < 40 ms) are merged unless the loudness dips between them
 *   (a consonant or a re-pluck means a real new note);
 * - a note start moves back to the loudness dip just before it (the consonant), up to 80 ms.
 */
export function cleanMono(notes: RawNote[], audio: Float32Array, rate: number): RawNote[] {
  if (notes.length < 2) return notes;
  const { db, hop } = envelopeDb(audio, rate);
  const fr = (t: number) => Math.max(0, Math.min(db.length - 1, Math.round((t * rate) / hop)));
  const dipAt = (t: number): number => {
    // How far the loudness dips around t below the louder side within 100 ms.
    const c = fr(t);
    let lo = Infinity;
    for (let k = c - 3; k <= c + 2; k++) if (k >= 0 && k < db.length) lo = Math.min(lo, db[k]!);
    let left = -Infinity;
    for (let k = c - 10; k < c - 3; k++) if (k >= 0) left = Math.max(left, db[k]!);
    let right = -Infinity;
    for (let k = c + 3; k <= c + 10; k++) if (k < db.length) right = Math.max(right, db[k]!);
    return Math.min(left, right) - lo;
  };
  // Pass 1: join same-pitch pieces that touch, unless the loudness dips between them.
  const runs: RawNote[] = [];
  for (const n of notes) {
    const prev = runs[runs.length - 1];
    if (prev && Math.round(n.midi) === Math.round(prev.midi) && n.start - prev.end < 0.04 && dipAt(n.start) < 4) {
      prev.end = Math.max(prev.end, n.end);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    runs.push({ ...n, midi: Math.round(n.midi) });
  }
  // Pass 2: a short (< 100 ms) piece a semitone away from a touching neighbour is a glide or a
  // vibrato crossing, not a note: absorb it (into the following note when it leads into it).
  const out: RawNote[] = [];
  for (let i = 0; i < runs.length; i++) {
    const n = runs[i]!;
    const next = runs[i + 1];
    const prev = out[out.length - 1];
    const short = n.end - n.start < 0.1;
    const touchesNext = next && next.start - n.end < 0.04 && Math.abs(next.midi - n.midi) <= 1;
    const touchesPrev = prev && n.start - prev.end < 0.04 && Math.abs(prev.midi - n.midi) <= 1;
    if (short && touchesNext && dipAt(next.start) < 4) {
      next.start = n.start; // leads into the next note
      continue;
    }
    if (short && touchesPrev && dipAt(n.start) < 4) {
      prev.end = Math.max(prev.end, n.end);
      continue;
    }
    // A same-pitch neighbour may now touch after absorbing a glide.
    if (prev && prev.midi === n.midi && n.start - prev.end < 0.04 && dipAt(n.start) < 4) {
      prev.end = Math.max(prev.end, n.end);
      continue;
    }
    out.push({ ...n });
  }
  // Start = the consonant dip when the model reported the note clearly late (> 40 ms after it).
  return out.map((n, i) => {
    const from = Math.max(i > 0 ? out[i - 1]!.start + 0.05 : 0, n.start - 0.1);
    let minK = -1;
    for (let k = fr(from); k <= fr(n.start); k++) if (minK < 0 || db[k]! < db[minK]!) minK = k;
    const dipT = (minK * hop) / rate;
    const start = minK >= 0 && n.start - dipT > 0.04 && dipAt(dipT) >= 4 ? dipT + 0.02 : n.start;
    return { ...n, start };
  });
}

/**
 * Transcribes a recording. `offset` (s) is removed from all times (count-in + measured latency), so
 * 0 = the first recorded bar. Falls back to the live tracker if the model can't run.
 */
export async function transcribe(
  audio: Float32Array,
  rate: number,
  source: CaptureSource,
  opts: { offset?: number; files?: ModelFiles | null; onProgress?: (p: number) => void } = {},
): Promise<Transcription> {
  const offset = opts.offset ?? 0;
  const shift = (ns: RawNote[]) => ns.map((n) => ({ ...n, start: n.start - offset, end: n.end - offset })).filter((n) => n.end > 0);
  try {
    const files = opts.files === undefined ? await bundledModelFiles() : opts.files;
    if (!files) throw new Error('no model');
    const events = await runBasicPitch(audio, rate, source, files, opts.onProgress);
    let notes: RawNote[] = events.map((e) => ({
      start: e.startTimeSeconds,
      end: e.startTimeSeconds + e.durationSeconds,
      midi: e.pitchMidi,
      velocity: Math.max(1, Math.min(127, Math.round(40 + e.amplitude * 87))),
    }));
    if (source !== 'chords') notes = cleanMono(toMonophonic(notes), audio, rate);
    return { source, notes: shift(notes), model: true };
  } catch {
    return { source, notes: shift(segmentNotes(trackPitch(audio, rate, source))), model: false };
  }
}
