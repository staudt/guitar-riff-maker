// Live pitch trace: cyan line in a 12-semitone window that re-centres on the voice, with bar/beat lines.
import { useEffect, useRef } from 'preact/hooks';
import { getRun, options } from '../capture/session';
import { hzToMidi } from '../capture/pitch';
import type { PitchFrame } from '../capture/types';
import './capture.css';

const ROWS = 12;
const LABEL_W = 34;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const START_LO = { whistle: 79, voice: 53 } as const;

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

export function PitchTrace() {
  const ref = useRef<HTMLCanvasElement>(null);
  const lo = useRef<number>(START_LO[options.value.source]);
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
      if (!r && idleSource.current !== src) { idleSource.current = src; lo.current = START_LO[src]; }
      if (r) {
        const fr = r.live.frames;
        let cur: PitchFrame | null = null;
        for (let i = fr.length - 1; i >= Math.max(0, fr.length - 6); i--) if (fr[i]!.hz > 0) { cur = fr[i]!; break; }
        if (cur) {
          const m = hzToMidi(cur.hz);
          if (m < lo.current || m > lo.current + ROWS - 1) lo.current = Math.round(m) - Math.floor(ROWS / 2);
        }
      }
      const base = lo.current;
      const rowH = h / ROWS;
      const plotW = w - LABEL_W;
      g.font = '10px "IBM Plex Mono", monospace';
      g.textBaseline = 'middle';
      for (let i = 0; i < ROWS; i++) {
        const midi = base + ROWS - 1 - i;
        const y = i * rowH;
        if (midi % 12 === 0) { g.fillStyle = cRow; g.fillRect(0, y, w, rowH); }
        g.fillStyle = cBorder;
        g.fillRect(0, y + rowH - 1, w, 1);
        g.fillStyle = cText;
        g.fillText(noteName(midi), 8, y + rowH / 2);
      }
      const bars = r ? r.bars : options.value.bars;
      for (let b = 0; b <= bars * 4; b++) {
        const x = LABEL_W + (plotW * b) / (bars * 4) - (b === bars * 4 ? 1 : 0);
        g.fillStyle = cBorder;
        g.globalAlpha = b % 4 === 0 ? 1 : 0.45;
        g.fillRect(x, 0, 1, h);
      }
      g.globalAlpha = 1;
      g.fillStyle = cText;
      for (let b = 0; b < bars; b++) g.fillText(`${b + 1}`, LABEL_W + (plotW * b) / bars + 4, 9);

      if (!r) return;
      const totalS = r.bars * r.barDur;
      const xOf = (t: number) => LABEL_W + (plotW * (t - r.offset)) / totalS;
      const yOf = (m: number) => h - (m - base + 0.5) * rowH;
      g.strokeStyle = cTrace;
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      let prev = 0;
      for (const f of r.live.frames) {
        if (f.hz <= 0) { pen = false; continue; }
        const x = xOf(f.t);
        if (x < LABEL_W - 4 || x > w) { pen = false; continue; }
        const m = hzToMidi(f.hz);
        if (pen && Math.abs(m - prev) > 2.5) pen = false;
        if (pen) g.lineTo(x, yOf(m)); else g.moveTo(x, yOf(m));
        pen = true;
        prev = m;
      }
      g.stroke();
      const head = (r.ctx.currentTime - r.tBar1) / r.barDur;
      if (head >= 0 && head <= r.bars) {
        g.fillStyle = cAccent;
        g.fillRect(LABEL_W + (plotW * head) / r.bars - 1, 0, 2, h);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} class="pitch-trace" data-testid="pitch-trace" aria-label="Pitch trace" />;
}
