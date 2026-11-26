// Where each riff note is played on the neck. Derived, never stored: recomputed from the riff
// (notes, pins, tuning, power mode, region choice) whenever it changes.
import { computed } from '@preact/signals';
import type { Pos } from '../music/types';
import { bestRegions, fingerRiff, isPlayable } from '../music/fretboard';
import { bestPowerRegions, fingerPower } from '../music/powerchord';
import { stepSeconds, type Riff } from './riff';
import { riff } from './store';

export type RiffFingering = {
  /** Per note: the positions to fret (1 for single notes, 2-3 for power chords). Fret -1 = unplayable. */
  pos: Pos[][];
  /** Per note: index-finger fret of the hand window. */
  hands: number[];
  /** Region choices for the "pos ◀▶" control (auto mode), lowest anchor first. */
  options: { anchor: number; cost: number }[];
  /** Index of the option in use (auto mode), else -1. */
  choice: number;
  /** Median hand position (fret) — where the neck view centres. */
  anchor: number;
};

const SPAN = 4;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function fingeringFor(r: Riff): RiffFingering {
  const sec = stepSeconds(r);
  const notes = r.notes.map((n) => ({ midi: n.midi, pin: n.pin, start: n.step * sec, end: (n.step + n.length) * sec }));
  const opt = { maxFret: r.maxFret, span: SPAN };
  const power = r.power !== 'off' ? r.power : null;

  if (r.region.mode === 'anchor') {
    const target = r.region.fret;
    const f = power ? fingerPower(notes, r.tuning, power, { ...opt, target }) : fingerRiff(notes, r.tuning, { ...opt, target });
    const shapes = 'shapes' in f ? (f.shapes as Pos[][]) : null;
    return {
      pos: f.pos.map((p, i) => (shapes && shapes[i]?.length ? shapes[i]! : [p])),
      hands: f.hands,
      options: [],
      choice: -1,
      anchor: median(f.hands),
    };
  }

  const all = power ? bestPowerRegions(notes, r.tuning, power, opt) : bestRegions(notes, r.tuning, opt);
  // Drop positions that are far worse than the best one (e.g. sliding a whole riff along one string):
  // they're technically playable but no guitarist would choose them.
  const best = Math.min(...all.map((x) => x.cost));
  const regions = all.filter((x) => x.cost <= Math.max(best * 3, best + 12));
  if (!regions.length) return { pos: notes.map(() => []), hands: [], options: [], choice: -1, anchor: 0 };
  const cheapest = regions.reduce((b, x, i) => (x.cost < regions[b]!.cost ? i : b), 0);
  const choice = r.region.choice < 0 ? cheapest : Math.min(r.region.choice, regions.length - 1);
  const pick = regions[choice]!;
  const shapes = 'shapes' in pick ? (pick.shapes as Pos[][]) : null;
  return {
    pos: pick.pos.map((p, i) => (shapes && shapes[i]?.length ? shapes[i]! : [p])),
    hands: pick.hands,
    options: regions.map(({ anchor, cost }) => ({ anchor, cost })),
    choice,
    anchor: pick.anchor,
  };
}

export const playable = (p: Pos[]) => p.length > 0 && p.every(isPlayable);

export const fingering = computed(() => fingeringFor(riff.value));
