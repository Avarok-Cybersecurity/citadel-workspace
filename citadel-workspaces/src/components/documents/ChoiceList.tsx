/**
 * A labelled radio list whose every row is a 44px target: the whole row is the label, so a
 * finger or a pointer anywhere on it chooses, and arrow keys move between the rows (Radix).
 * Nothing is chosen until the person chooses; a disabled row says why in its own text.
 */
import type { ComponentType } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export interface Choice {
  value: string;
  label: string;
  detail: string;
  icon?: ComponentType<{ className?: string }>;
  /** Null when it may be chosen; otherwise why not, shown on the row. */
  unavailable: string | null;
}

interface ChoiceListProps {
  legend: string;
  choices: readonly Choice[];
  value: string | null;
  onChange: (value: string) => void;
  testId: string;
}

export function ChoiceList({ legend, choices, value, onChange, testId }: ChoiceListProps): JSX.Element {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <RadioGroup value={value ?? ''} onValueChange={onChange} aria-label={legend} data-testid={testId} className="gap-1">
        {choices.map((choice: Choice): JSX.Element => {
          const id: string = `${testId}-${choice.value}`;
          const Icon: ComponentType<{ className?: string }> | undefined = choice.icon;
          return (
            <label
              key={choice.value}
              htmlFor={id}
              data-testid={id}
              className={`flex min-h-[44px] items-center gap-3 rounded-md border border-border px-3 py-2 ${
                choice.unavailable === null ? 'cursor-pointer hover:bg-accent' : 'cursor-not-allowed opacity-60'
              }`}
            >
              <RadioGroupItem id={id} value={choice.value} disabled={choice.unavailable !== null} aria-describedby={`${id}-detail`} />
              {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{choice.label}</span>
                <span id={`${id}-detail`} className="text-xs text-muted-foreground">
                  {choice.unavailable ?? choice.detail}
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
