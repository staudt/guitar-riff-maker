export interface ChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  testId?: string;
}

/** Pill-shaped toggle chip. Active = amber. */
export function Chip(props: ChipProps) {
  const { label, active = false, onPress, testId } = props;
  return (
    <button
      type="button"
      class="ui-chip"
      aria-pressed={active}
      data-testid={testId}
      onClick={() => onPress()}
    >
      {label}
    </button>
  );
}
