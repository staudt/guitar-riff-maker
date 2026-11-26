import './lesson.css';
import { countInBeat } from './playhead';

/** Full-screen "1 2 3 4" shown while the engine counts in. */
export function CountInOverlay() {
  const beat = countInBeat.value;
  if (beat === null) return null;
  return (
    <div class="countin" data-testid="count-in" aria-hidden="true">
      <div class="countin__row">
        {[1, 2, 3, 4].map((b) => (
          <span key={b} class="countin__n" data-current={b === beat ? '' : undefined}>
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}
