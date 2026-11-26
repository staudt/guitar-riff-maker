export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  testId?: string;
}

/** Segmented control built from pressable chips. The selected option is amber. */
export function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  const { options, value, onChange, testId } = props;
  return (
    <div class="ui-segmented" role="group" data-testid={testId}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          class="ui-segmented__opt"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
