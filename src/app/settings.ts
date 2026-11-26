// Persisted UI settings. Each is a signal; setSetting() updates it and writes localStorage.
import { signal } from '@preact/signals';

const KEY = 'riffmaker.settings';

export const lefty = signal(false);
/** Low string drawn at the bottom of the neck (like looking down at your guitar). */
export const lowStringBottom = signal(true);
/** Neck dots show note names instead of fret numbers. */
export const showNoteNames = signal(false);
export const metronome = signal(true);
export const countIn = signal(true);

export const settings = { lefty, lowStringBottom, showNoteNames, metronome, countIn } as const;
export type SettingKey = keyof typeof settings;

function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(settings) as SettingKey[]) {
      if (typeof o[k] === 'boolean') settings[k].value = o[k] as boolean;
    }
  } catch {
    /* storage unavailable or corrupt: keep defaults */
  }
}

function save(): void {
  try {
    const o: Record<string, boolean> = {};
    for (const k of Object.keys(settings) as SettingKey[]) o[k] = settings[k].value;
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function setSetting(key: SettingKey, value: boolean): void {
  settings[key].value = value;
  save();
}

load();
