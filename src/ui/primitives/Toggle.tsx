export interface ToggleProps {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  testId?: string;
}

/** Pill switch with a visible label. Exposed as role="switch". */
export function Toggle(props: ToggleProps) {
  const { label, on, onChange, testId } = props;
  return (
    <button
      type="button"
      role="switch"
      class="ui-toggle"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
    >
      <span class="ui-toggle__label">{label}</span>
      <span class="ui-toggle__track" aria-hidden="true">
        <span class="ui-toggle__knob" />
      </span>
    </button>
  );
}
