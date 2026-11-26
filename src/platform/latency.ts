// Round-trip latency calibration: play clicks through the speakers, record them through the mic, and
// measure how late they arrive. The result (per device, in localStorage) shifts recorded audio back
// onto the beat in Capture. Detection is a pure function so it can be tested with synthetic audio.
import { ensureRunning } from './audio';
import { startLive } from '../capture/live';

const KEY = 'riffmaker.latencyMs';
export const CLICK_COUNT = 6;
const CLICK_GAP = 0.6; // s
const MAX_DELAY = 0.45; // s; longer round trips are not plausible (and would overlap the next click)

export function getLatencyMs(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function setLatencyMs(ms: number): void {
  try { localStorage.setItem(KEY, String(Math.max(0, Math.round(ms)))); } catch { /* storage unavailable */ }
}

/** Schedules a short click on the AudioContext timeline (sample-accurate start at `time`). */
export function scheduleClick(ctx: AudioContext, time: number, accent = false, gain = 0.5): { stop(): void } {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 2000 : 1400;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.0008);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.04);
  return { stop: () => { try { osc.stop(0); osc.disconnect(); g.disconnect(); } catch { /* already stopped */ } } };
}

const median = (a: number[]): number => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * For each expected click time (seconds from the start of `rec`), the delay (s) until its first
 * arrival in the recording, or null if it cannot be told from the noise. The arrival is the first
 * sample reaching 25 % of the way from the noise floor to the click's peak.
 */
export function detectClickDelays(rec: Float32Array, rate: number, clickTimes: readonly number[], maxDelay = MAX_DELAY): (number | null)[] {
  const block = Math.max(1, Math.round(rate * 0.001));
  const nb = Math.floor(rec.length / block);
  const env = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let m = 0;
    for (let i = b * block; i < (b + 1) * block; i++) m = Math.max(m, Math.abs(rec[i]!));
    env[b] = m;
  }
  const noise = median(Array.from(env));
  return clickTimes.map((c) => {
    const a = Math.max(0, Math.floor(((c - 0.02) * rate) / block));
    const z = Math.min(nb - 1, Math.ceil(((c + maxDelay) * rate) / block));
    let peak = 0;
    for (let b = a; b <= z; b++) peak = Math.max(peak, env[b]!);
    if (peak < Math.max(0.004, 4 * noise)) return null;
    const thr = noise + 0.25 * (peak - noise);
    for (let b = a; b <= z; b++) {
      if (env[b]! < thr) continue;
      for (let i = b * block; i < (b + 1) * block; i++) if (Math.abs(rec[i]!) >= thr) return i / rate - c;
    }
    return null;
  });
}

/** Median round trip in ms from per-click delays, or null when fewer than 3 clicks were heard. */
export function medianLatencyMs(delays: readonly (number | null)[]): number | null {
  const ok = delays.filter((d): d is number => d !== null && d >= 0);
  return ok.length >= 3 ? median(ok) * 1000 : null;
}

/** Plays clicks and records them; resolves with the round trip in ms (also stored), or null if they were not heard. Mic errors reject. */
export async function calibrateLatency(): Promise<number | null> {
  const ctx = await ensureRunning();
  const live = await startLive('voice', { track: false });
  const t0 = ctx.currentTime + 0.4;
  const times = Array.from({ length: CLICK_COUNT }, (_, k) => t0 + k * CLICK_GAP);
  times.forEach((t) => scheduleClick(ctx, t, true, 0.9));
  const wait = (times[CLICK_COUNT - 1]! + MAX_DELAY + 0.2 - ctx.currentTime) * 1000;
  await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  const { l, rate } = await live.stop();
  const ms = medianLatencyMs(detectClickDelays(l, rate, times.map((t) => t - live.startTime)));
  if (ms !== null) setLatencyMs(ms);
  return ms === null ? null : Math.round(ms);
}
