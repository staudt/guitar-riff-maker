// Note accuracy against an expected list (for fixture tests and the in-app fixture check).
// A note is right when its pitch matches (after octave normalization when `octaveFree`) and it
// starts within `onsetTol` seconds of an unmatched expected note. Each expected note matches once.

export type NoteLike = { start: number; midi: number };

export function noteAccuracy(expected: NoteLike[], got: NoteLike[], opts: { onsetTol?: number; octaveFree?: boolean } = {}): { accuracy: number; matched: number; extra: number } {
  const tol = opts.onsetTol ?? 0.05;
  // Whistles land one or two octaves high: align by the median octave difference first.
  let shift = 0;
  if (opts.octaveFree && got.length && expected.length) {
    const diffs = got.map((g) => Math.round(g.midi) - Math.round(nearest(expected, g.start).midi));
    const octs = diffs.map((d) => Math.round(d / 12)).sort((a, b) => a - b);
    shift = octs[Math.floor(octs.length / 2)]! * 12;
  }
  const used = new Set<number>();
  let matched = 0;
  for (const e of expected) {
    let pick = -1;
    let bestDt = Infinity;
    got.forEach((g, i) => {
      if (used.has(i)) return;
      const dt = Math.abs(g.start - e.start);
      if (dt <= tol && Math.round(g.midi) - shift === Math.round(e.midi) && dt < bestDt) {
        bestDt = dt;
        pick = i;
      }
    });
    if (pick >= 0) {
      used.add(pick);
      matched++;
    }
  }
  return { accuracy: expected.length ? matched / expected.length : 1, matched, extra: got.length - used.size };
}

function nearest(xs: NoteLike[], t: number): NoteLike {
  let best = xs[0]!;
  for (const x of xs) if (Math.abs(x.start - t) < Math.abs(best.start - t)) best = x;
  return best;
}

/**
 * Grid accuracy for recordings made against a click (the fixture recorder): a note is right when
 * it lands on the same 1/8 (or 1/16) step with the same pitch. A global time offset (recording
 * start vs. the click, within ±0.3 s) is searched first, so the device's latency doesn't matter.
 */
export function gridAccuracy(
  expected: NoteLike[],
  got: NoteLike[],
  opts: { bpm: number; grid?: 8 | 16; octaveFree?: boolean },
): { accuracy: number; matched: number; extra: number; offset: number } {
  const stepS = (60 / opts.bpm / 4) * (opts.grid === 16 ? 1 : 2);
  const slot = (t: number) => Math.round(t / stepS);
  let best = { accuracy: 0, matched: 0, extra: got.length, offset: 0 };
  let bestDev = Infinity;
  for (let o = -0.3; o <= 0.3001; o += 0.005) {
    const shifted = got.map((g) => ({ start: g.start - o, midi: g.midi }));
    // Octave normalization as in noteAccuracy.
    let shift = 0;
    if (opts.octaveFree && shifted.length && expected.length) {
      const d = shifted.map((g) => Math.round((Math.round(g.midi) - Math.round(nearest(expected, g.start).midi)) / 12)).sort((a, b) => a - b);
      shift = d[Math.floor(d.length / 2)]! * 12;
    }
    const used = new Set<number>();
    let matched = 0;
    let dev = 0; // tie-break: how far matched notes sit from the expected onsets
    for (const e of expected) {
      const i = shifted.findIndex((g, k) => !used.has(k) && slot(g.start) === slot(e.start) && Math.round(g.midi) - shift === Math.round(e.midi));
      if (i >= 0) {
        used.add(i);
        matched++;
        dev += Math.abs(shifted[i]!.start - e.start);
      }
    }
    if (matched > best.matched || (matched === best.matched && matched > 0 && dev < bestDev)) {
      best = { accuracy: expected.length ? matched / expected.length : 1, matched, extra: got.length - used.size, offset: o };
      bestDev = dev;
    }
  }
  return best;
}
