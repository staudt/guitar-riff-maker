// Live pitch trace: the whole take so far as a cyan line (time axis grows to fit; pitch window follows everything sung, at least 12 semitones). Beat lines only with the metronome.
import { useEffect, useRef } from 'preact/hooks';
import { getRun, options } from '../capture/session';
import { hzToMidi } from '../capture/pitch';
import './capture.css';

const MIN_ROWS = 12;
/** Seconds shown before the take outgrows the screen; after that the whole take is squeezed to fit. */
const MIN_WIN = 6;
const LABEL_W = 34;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const START_LO = { whistle: 79, voice: 53 } as const;

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

export function PitchTrace() {
  const ref = useRef<HTMLCanvasElement>(null);
  // Smoothed pitch window (bottom MIDI, number of rows) and the running min/max of everything sung so far.
  const view = useRef({ lo: START_LO[options.value.source] as number, rows: MIN_ROWS, scanned: 0, min: Infinity, max: -Infinity, live: null as unknown });
  const idleSource = useRef(options.value.source);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w === 0 || h === 0) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d');
      if (!g) return;
      const cText = cssVar(cv, '--muted');
      const cBorder = cssVar(cv, '--border');
      const cRow = cssVar(cv, '--surface-2');
      const cTrace = cssVar(cv, '--trace');
      const cAccent = cssVar(cv, '--accent');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const r = getRun();
      const src = options.value.source;
      const v = view.current;
      if (!r && idleSource.current !== src) { idleSource.current = src; v.lo = START_LO[src]; v.rows = MIN_ROWS; }
      const fr = r ? r.live.frames : null;
      if (r && fr) {
        if (v.live !== r.live) { v.live = r.live; v.scanned = 0; v.min = Infinity; v.max = -Infinity; }
        for (; v.scanned < fr.length; v.scanned++) {
          const f = fr[v.scanned]!;
          if (f.hz <= 0) continue;
          const m = hzToMidi(f.hz);
          if (m < v.min) v.min = m;
          if (m > v.max) v.max = m;
        }
      }
      // Target window: everything sung so far +-2 semitones, at least 12 rows, centred when narrower.
      let tLo = v.lo;
      let tRows = MIN_ROWS;
      if (v.max >= v.min) {
        const lo = Math.floor(v.min - 2);
        const hi = Math.ceil(v.max + 2);
        tRows = Math.max(MIN_ROWS, hi - lo + 1);
        tLo = lo - Math.floor((tRows - (hi - lo + 1)) / 2);
      }
      const k = r ? 0.2 : 1;
      v.lo += (tLo - v.lo) * k;
      v.rows += (tRows - v.rows) * k;
      const base = v.lo;
      const rows = v.rows;
      const rowH = h / rows;
      const plotW = w - LABEL_W;
      g.font = '10px "IBM Plex Mono", monospace';
      g.textBaseline = 'middle';
      const top = Math.ceil(base + rows - 1);
      for (let midi = Math.floor(base); midi <= top; midi++) {
        const y = h - (midi - base + 1) * rowH;
        if (y < -rowH || y > h) continue;
        if (midi % 12 === 0) { g.fillStyle = cRow; g.fillRect(0, y, w, rowH); }
        g.fillStyle = cBorder;
        g.fillRect(0, y + rowH - 1, w, 1);
        if (rowH >= 12 || midi % 12 === 0 || midi % 12 === 7) {
          g.fillStyle = cText;
          g.fillText(noteName(midi), 8, y + rowH / 2);
        }
      }
      if (!r || !fr) return;
      const t0 = r.tBar1 - r.live.startTime;
      const cur = r.endT ?? Math.max(0, r.ctx.currentTime - r.live.startTime);
      // The whole take stays on screen: the axis is 6 s wide, then grows to fit what has been recorded.
      const win = Math.max(MIN_WIN, cur);
      const xOf = (t: number) => LABEL_W + (plotW * t) / win;
      const yOf = (m: number) => h - (m - base + 0.5) * rowH;
      if (r.metronome) {
        for (let b = 0; t0 + b * r.beatS <= cur; b++) {
          const x = xOf(t0 + b * r.beatS);
          g.fillStyle = cBorder;
          g.globalAlpha = b % 4 === 0 ? 1 : 0.45;
          g.fillRect(x, 0, 1, h);
        }
        g.globalAlpha = 1;
      }
      g.strokeStyle = cTrace;
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      let prevM = 0;
      for (let i = 0; i < fr.length; i++) {
        const f = fr[i]!;
        if (f.hz <= 0) { pen = false; continue; }
        const x = xOf(f.t);
        const m = hzToMidi(f.hz);
        if (pen && Math.abs(m - prevM) > 2.5) pen = false;
        if (pen) g.lineTo(x, yOf(m)); else g.moveTo(x, yOf(m));
        pen = true;
        prevM = m;
      }
      g.stroke();
      if (r.endT === null) {
        g.fillStyle = cAccent;
        g.fillRect(xOf(cur) - 1, 0, 2, h);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} class="pitch-trace" data-testid="pitch-trace" aria-label="Pitch trace" />;
}
