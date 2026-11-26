import './lesson.css';
import { useEffect } from 'preact/hooks';
import { StompButton } from './primitives';
import { TransportBar } from './TransportBar';
import { audition } from './audition';
import { clearHighlight, highlight } from './playhead';
import { countIn } from '../app/settings';
import { loop, play, playing, rate, stop } from '../audio/sync';
import { fingering } from '../model/fingering';
import { lessonIndex, lessonMode, nextIndex, prevIndex } from '../model/lesson';
import { riff } from '../model/store';
import { stringName } from '../music/tuning';

function sound(i: number): void {
  const r = riff.value;
  const n = r.notes[i];
  if (!n) return;
  const stepSec = 60 / r.bpm / 4;
  audition([n.midi], n.velocity, (n.length * stepSec) / rate.value);
}

function goto(i: number): void {
  lessonIndex.value = i;
  highlight(i);
  sound(i);
}

const stepNext = () => goto(nextIndex(riff.value.notes, lessonIndex.value, loop.value));
const stepPrev = () => goto(prevIndex(riff.value.notes, lessonIndex.value, loop.value));

export function LessonPanel() {
  const mode = lessonMode.value;
  const r = riff.value;
  const i = lessonIndex.value;

  // Entering step mode stops playback; leaving it clears the step highlight.
  useEffect(() => {
    if (mode === 'step') {
      stop();
      if (lessonIndex.value >= 0) highlight(lessonIndex.value);
    } else {
      clearHighlight();
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'step') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const note = i >= 0 ? r.notes[i] : undefined;
  const pos = i >= 0 ? fingering.value.pos[i]?.[0] : undefined;
  let caption = 'Press Next to start';
  if (note) {
    caption = `note ${i + 1}/${r.notes.length}`;
    if (pos && pos.fret >= 0) caption += ` · fret ${pos.fret} on string ${stringName(r.tuning, pos.string)}`;
  }

  return (
    <section class="lesson" data-testid="lesson-panel">
      <TransportBar />
      {mode === 'play' ? (
        <div class="lesson__big">
          <StompButton
            testId="lesson-play"
            label={playing.value ? 'STOP' : 'PLAY'}
            icon={playing.value ? 'stop' : 'play'}
            active={playing.value}
            onPress={() => (playing.value ? stop() : void play(loop.value.start, countIn.value))}
          />
        </div>
      ) : (
        <div class="lesson__big">
          <div class="lesson__caption" data-testid="step-caption">
            {caption}
          </div>
          <div class="lesson__steps">
            <button type="button" class="lesson__btn" data-testid="step-prev" onClick={stepPrev}>
              ◀ PREV
            </button>
            <button type="button" class="lesson__btn lesson__btn--go" data-testid="step-next" onClick={stepNext}>
              NEXT ▶
            </button>
          </div>
          <button type="button" class="lesson__btn lesson__btn--ghost" data-testid="step-replay" onClick={() => sound(i)}>
            Replay
          </button>
        </div>
      )}
    </section>
  );
}
