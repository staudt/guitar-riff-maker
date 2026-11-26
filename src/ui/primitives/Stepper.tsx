export interface StepperProps {
  /** Names the control for assistive tech, e.g. "Tempo" gives "Decrease Tempo" / "Increase Tempo". */
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
  testId?: string;
}

/** Compact [◀ value ▶] control. The value is set in the mono font. */
export function Stepper(props: StepperProps) {
  const { label, value, onDec, onInc, decDisabled = false, incDisabled = false, testId } = props;
  return (
    <div class="ui-stepper" role="group" aria-label={label} data-testid={testId}>
      <button
        type="button"
        class="ui-stepper__btn"
        aria-label={`Decrease ${label}`}
        disabled={decDisabled}
        onClick={() => onDec()}
      >
        ◀
      </button>
      <span class="ui-stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        class="ui-stepper__btn"
        aria-label={`Increase ${label}`}
        disabled={incDisabled}
        onClick={() => onInc()}
      >
        ▶
      </button>
    </div>
  );
}
