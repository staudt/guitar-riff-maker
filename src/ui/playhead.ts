// Drives playback visuals straight from engine events: direct DOM writes, no component re-renders per frame.
import { signal } from '@preact/signals';
import type { Evt } from '../audio/protocol';
import { contextTime, onEvent, outputLatency } from '../audio/host';
import { loop, playing } from '../audio/sync';
import { fingering } from '../model/fingering';
import { nextIndex } from '../model/lesson';
import { riff } from '../model/store';
import { getTabStepX } from './TabView';
import { getRollStepX } from './rollGeometry';
import { neckPoint } from './NeckView';

/** Count-in beat 1..4 while counting in, else null. */
export const countInBeat = signal<number | null>(null);

const ROLL_LABEL_W = 40; // keep in sync with rollGeometry LABEL_W (the playhead's CSS left offset)
let lastRollScroll = 0;
const MARKED = '[data-note-index],[data-note-indexes]';

let curActive = -1;
let curNext = -1;
let curStep: number | null = null;
type Timed = Exclude<Evt, { type: 'stopped' }>;
let queue: Timed[] = [];
let raf = 0;
let installed = false;

declare global {
  interface Window {
    __engineEvents?: Evt[];
  }
}

/** True when `el`'s data-note-index equals i, or data-note-indexes (comma list) contains it. */
export function matchesIndex(el: Element, i: number): boolean {
  const one = el.getAttribute('data-note-index');
  if (one !== null && Number(one) === i) return true;
  const many = el.getAttribute('data-note-indexes');
  return many !== null && many.split(',').some((s) => s.trim() !== '' && Number(s) === i);
}

function mark(attr: 'data-active' | 'data-next', i: number): void {
  if (i < 0) return;
  document.querySelectorAll(MARKED).forEach((el) => {
    if (matchesIndex(el, i)) el.setAttribute(attr, '');
  });
}

function unmark(): void {
  document.querySelectorAll('[data-active],[data-next]').forEach((el) => {
    if (el.hasAttribute('data-note-index') || el.hasAttribute('data-note-indexes')) {
      el.removeAttribute('data-active');
      el.removeAttribute('data-next');
    }
  });
}

function moveLine(a: number, b: number): void {
  const line = document.querySelector<SVGLineElement>('line[data-move]');
  if (!line) return;
  const pa = fingering.value.pos[a]?.[0];
  const pb = fingering.value.pos[b]?.[0];
  if (!pa || !pb || pa.fret < 0 || pb.fret < 0 || a === b) {
    line.style.display = 'none';
    return;
  }
  const p = neckPoint(pa);
  const q = neckPoint(pb);
  line.setAttribute('x1', String(p.x));
  line.setAttribute('y1', String(p.y));
  line.setAttribute('x2', String(q.x));
  line.setAttribute('y2', String(q.y));
  line.style.display = '';
}

function hideLine(): void {
  const line = document.querySelector<SVGLineElement>('line[data-move]');
  if (line) line.style.display = 'none';
}

function scrollTabTo(i: number): void {
  const sc = document.querySelector<HTMLElement>('[data-testid="tab-scroll"]');
  if (!sc) return;
  const el = Array.from(sc.querySelectorAll('.tab__note,[data-testid="tab-note"]')).find((e) => matchesIndex(e, i));
  if (!el) return;
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  const pad = 24;
  if (r.left < s.left + pad || r.right > s.right - pad) {
    const target = sc.scrollLeft + (r.left - s.left) - s.width / 3;
    sc.scrollTo?.({ left: Math.max(0, target), behavior: 'smooth' });
  }
}

function nextOf(i: number): number {
  return nextIndex(riff.value.notes, i, loop.value);
}

function apply(): void {
  unmark();
  if (curActive < 0) {
    hideLine();
    return;
  }
  curNext = nextOf(curActive);
  mark('data-active', curActive);
  mark('data-next', curNext);
  moveLine(curActive, curNext);
}

/** Highlight note `index` (and the one after it), move the neck arrow, bring it into view. Used by step mode. */
export function highlight(index: number): void {
  curActive = index;
  apply();
  if (index >= 0) scrollTabTo(index);
}

export function clearHighlight(): void {
  curActive = -1;
  curNext = -1;
  unmark();
  hideLine();
}

function showPlayheads(step: number): void {
  curStep = step;
  const tab = document.querySelector<HTMLElement>('[data-tab-playhead]');
  if (tab) {
    tab.style.display = 'block';
    tab.style.transform = `translateX(${getTabStepX()(step)}px)`;
  }
  const roll = document.querySelector<HTMLElement>('[data-playhead]');
  if (roll) {
    roll.style.display = 'block';
    const x = getRollStepX()(step);
    roll.style.transform = `translateX(${x - ROLL_LABEL_W}px)`;
    followRoll(x);
  }
}

/** Keep the roll's playhead on screen while playing; smooth, and not more often than every 350 ms. */
function followRoll(x: number): void {
  const sc = document.querySelector<HTMLElement>('.roll__scroller');
  if (!sc || sc.clientWidth === 0) return;
  const left = sc.scrollLeft + ROLL_LABEL_W;
  const right = sc.scrollLeft + sc.clientWidth - 24;
  if (x >= left && x <= right) return;
  const now = performance.now();
  if (now - lastRollScroll < 350) return;
  lastRollScroll = now;
  sc.scrollTo?.({ left: Math.max(0, x - ROLL_LABEL_W - sc.clientWidth / 4), behavior: 'smooth' });
}

function hidePlayheads(): void {
  curStep = null;
  document.querySelectorAll<HTMLElement>('[data-tab-playhead],[data-playhead]').forEach((el) => {
    el.style.display = 'none';
  });
}

function handle(e: Evt): void {
  if (e.type === 'note') {
    curActive = e.index;
    apply();
    scrollTabTo(e.index);
  } else if (e.type === 'step') {
    if (e.step >= 0) {
      countInBeat.value = null;
      showPlayheads(e.step);
    } else {
      countInBeat.value = 4 - ((Math.round(-e.step / 4) - 1) % 4);
    }
  } else {
    queue = [];
    countInBeat.value = null;
    hidePlayheads();
    clearHighlight();
    playing.value = false;
  }
}

function frame(): void {
  raf = 0;
  if (!queue.length) return;
  const heard = contextTime() - outputLatency();
  while (queue.length && queue[0]!.time <= heard) handle(queue.shift()!);
  if (queue.length) raf = requestAnimationFrame(frame);
}

function enqueue(e: Evt): void {
  if (import.meta.env.MODE === 'test') (window.__engineEvents ??= []).push(e);
  if (e.type === 'stopped') {
    handle(e);
    return;
  }
  let i = queue.length;
  while (i > 0 && queue[i - 1]!.time > e.time) i--;
  queue.splice(i, 0, e);
  if (!raf) raf = requestAnimationFrame(frame);
}

/** Subscribe to engine events and drive highlights/playheads. Call once; returns an uninstall function. */
export function installPlayhead(): () => void {
  if (installed) return () => {};
  installed = true;
  const off = onEvent(enqueue);
  let pending = 0;
  const mo = new MutationObserver(() => {
    if (pending || (curActive < 0 && curStep === null)) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (curActive >= 0) apply();
      if (curStep !== null) showPlayheads(curStep);
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => {
    installed = false;
    off();
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (pending) cancelAnimationFrame(pending);
    raf = 0;
    queue = [];
    countInBeat.value = null;
    hidePlayheads();
    clearHighlight();
  };
}
