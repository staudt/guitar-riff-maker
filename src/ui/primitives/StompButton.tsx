import type { JSX } from 'preact';

export type StompIcon = 'rec' | 'play' | 'stop';
export type StompTone = 'rec' | 'accent';
export type StompSize = 'lg' | 'md';

export interface StompButtonProps {
  label: string;
  icon?: StompIcon;
  active?: boolean;
  /** Colour of the LED ring and glyph when active. Defaults to amber (accent). */
  tone?: StompTone;
  onPress: () => void;
  /** `lg` is ~76px (default), `md` ~56px. */
  size?: StompSize;
  testId?: string;
}

const GLYPHS: Record<StompIcon, JSX.Element> = {
  rec: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7" fill="currentColor" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polygon points="8,5 19,12 8,19" fill="currentColor" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  ),
};

/** Big round "stomp switch" with an LED ring that glows while active. */
export function StompButton(props: StompButtonProps) {
  const { label, icon, active = false, tone = 'accent', onPress, size = 'lg', testId } = props;
  return (
    <button
      type="button"
      class={`ui-stomp ui-stomp--${size} ui-stomp--${tone}`}
      aria-pressed={active}
      aria-label={label}
      data-testid={testId}
      onClick={() => onPress()}
    >
      <span class="ui-stomp__led">
        <span class="ui-stomp__disc">{icon ? GLYPHS[icon] : null}</span>
      </span>
      <span class="ui-stomp__label" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
