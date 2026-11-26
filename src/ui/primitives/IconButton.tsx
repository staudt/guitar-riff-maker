export interface IconButtonProps {
  /** Accessible name. Also used as the tooltip. */
  label: string;
  /** Short text glyph shown in the button, e.g. "✕" or "⋯". */
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  /** When provided, the button is a toggle and exposes aria-pressed. */
  active?: boolean;
  testId?: string;
}

/** Square 44px icon-only button. Amber when active. */
export function IconButton(props: IconButtonProps) {
  const { label, glyph, onPress, disabled = false, active, testId } = props;
  return (
    <button
      type="button"
      class="ui-icon-btn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onPress()}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
