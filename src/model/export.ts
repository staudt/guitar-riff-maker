// Text, JSON and share/download export of a riff. Formatting is pure; only shareTab touches the browser.
import { layoutTab, layoutTabSequence, renderTabText } from '../music/tab';
import { pcName } from '../music/theory';
import { stringName } from '../music/tuning';
import { fingeringFor } from './fingering';
import { isFree, newId, parseRiff, totalSteps, type Riff } from './riff';

const POWER_LABEL: Record<Exclude<Riff['power'], 'off'>, string> = { r5: '5', r58: '5 & 8' };

/**
 * Plain-text tab: a header ("Name — A minor — 96 bpm — Standard", plus a power-chord line when on)
 * followed by the ASCII tab in the riff's current fingering.
 */
export function tabText(riff: Riff): string {
  const title = `${riff.name} — ${pcName(riff.key.tonic, false)} ${riff.key.scale} — ${isFree(riff) ? 'free time' : `${Math.round(riff.bpm)} bpm`} — ${riff.tuning.name}`;
  const header = riff.power === 'off' ? title : `${title}\nPower chords (${POWER_LABEL[riff.power]})`;
  const free = isFree(riff);
  const cols = (free ? layoutTabSequence : layoutTab)({
    notes: riff.notes.map((n) => ({ step: n.step, length: n.length })),
    pos: fingeringFor(riff).pos,
    strings: riff.tuning.strings.length,
    totalSteps: totalSteps(riff),
    grid: riff.grid,
  });
  const names = riff.tuning.strings.map((_, i) => stringName(riff.tuning, i));
  return renderTabText(header, cols, names, free ? { colsPerLine: 24 } : undefined);
}

export function exportJson(riff: Riff): string {
  return JSON.stringify(riff, null, 2);
}

/** Parses an exported riff. Gets a new id so importing never overwrites an existing riff. Throws on junk. */
export function importJson(text: string): Riff {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a riff file: invalid JSON');
  }
  return { ...parseRiff(raw), id: newId() };
}

export type ShareResult = 'shared' | 'copied' | 'downloaded';

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

function fileBase(name: string): string {
  return name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'riff';
}

/**
 * Shares the tab text: Web Share sheet if available, else clipboard, else a .txt download.
 * Cancelling the share sheet rejects with AbortError so the caller can ignore it.
 */
export async function shareTab(riff: Riff): Promise<ShareResult> {
  const text = tabText(riff);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav?.share) {
    try {
      await nav.share({ title: riff.name, text });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) throw err;
      // Share not permitted here; fall through to the clipboard.
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      // Clipboard blocked (permissions, insecure context); fall through to download.
    }
  }

  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Sharing is not available in this environment');
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase(riff.name)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
