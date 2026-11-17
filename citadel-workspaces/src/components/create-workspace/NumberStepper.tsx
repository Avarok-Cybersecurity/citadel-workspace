import { useEffect, useState, type JSX } from 'react';
import { Plus } from 'lucide-react';

export interface NumberStepperProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly testId: string;
}

const BUTTON: string =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';

/**
 * A whole-number field with − and + either side.
 *
 * The text stays editable, because typing "40" is faster than forty presses,
 * and what is typed is kept as text until it is a number in range -- clamping
 * on every keystroke would turn a half-typed "4" of "40" into the minimum.
 */
export function NumberStepper({ id, label, value, min, max, onChange, testId }: NumberStepperProps): JSX.Element {
  const [text, setText] = useState<string>(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = (raw: string): void => {
    const parsed: number = Number.parseInt(raw, 10);
    const next: number = Number.isNaN(parsed) ? min : Math.min(Math.max(parsed, min), max);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="inline-flex h-11 overflow-hidden rounded-md border border-input bg-background">
      <button
        type="button"
        className={BUTTON}
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(value - 1, min))}
        data-testid={`${testId}-decrease`}
      >
        {/* A minus sign rather than lucide's Minus: every icon imported anywhere
            joins the eager vendor-icons chunk, and this would be the only use. */}
        <span aria-hidden="true" className="text-lg leading-none">&minus;</span>
      </button>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        value={text}
        data-testid={testId}
        onChange={(e) => {
          const digits: string = e.target.value.replace(/[^0-9]/g, '');
          setText(digits);
          const parsed: number = Number.parseInt(digits, 10);
          if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) onChange(parsed);
        }}
        onBlur={(e) => commit(e.target.value)}
        className="w-16 bg-transparent text-center text-base tabular-nums text-foreground outline-none"
      />
      <button
        type="button"
        className={BUTTON}
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(value + 1, max))}
        data-testid={`${testId}-increase`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
