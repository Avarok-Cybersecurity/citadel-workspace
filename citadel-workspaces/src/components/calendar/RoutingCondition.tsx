/**
 * One condition of a routing rule (design §3.6.3): which question, and what its answer must be.
 * A choice is tested by its options, any of those ticked; a text answer is, or contains, a text,
 * compared without regard to case (the core's `routing.rs`).
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Condition } from '@/lib/calendar/generated/Condition';
import type { Question } from '@/lib/calendar/generated/Question';
import { blankCondition, testValues } from '@/lib/calendar/routing-form-draft';
import { NativeSelect } from './NativeSelect';

interface RoutingConditionProps {
  /** "Rule 2, condition 1": every control's name starts with it. */
  name: string;
  condition: Condition;
  questions: readonly Question[];
  onChange: (next: Condition) => void;
  onRemove: (() => void) | null;
}

const CHIP: string = 'flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground has-[:checked]:border-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

export function RoutingCondition({ name, condition, questions, onChange, onRemove }: RoutingConditionProps): JSX.Element {
  const question: Question | undefined = questions.find((q: Question) => q.id === condition.question_id);
  const values: string[] = testValues(condition.test);
  const choose = (option: string, on: boolean): void => {
    const next: string[] = on ? [...values.filter((v: string) => v !== option), option] : values.filter((v: string) => v !== option);
    onChange({ ...condition, test: { is_one_of: { values: next } } });
  };
  const contains: boolean = 'contains' in condition.test;
  const text = (mode: 'is' | 'contains', value: string): Condition => ({ ...condition, test: mode === 'is' ? { is: { value } } : { contains: { text: value } } });
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex min-w-0 items-center gap-2">
        <NativeSelect aria-label={`${name}: question`} className="min-w-0 flex-1" value={condition.question_id}
          onChange={(e): void => {
            const picked: Question | undefined = questions.find((q: Question) => q.id === e.target.value);
            if (picked !== undefined) onChange(blankCondition(picked));
          }}>
          {question === undefined && <option value={condition.question_id}>A question no longer asked</option>}
          {questions.map((q: Question) => <option key={q.id} value={q.id}>{q.label === '' ? 'Untitled question' : q.label}</option>)}
        </NativeSelect>
        {onRemove !== null && (
          <Button type="button" variant="ghost" size="icon" className="h-[44px] w-[44px] shrink-0" aria-label={`Remove ${name.toLowerCase()}`} onClick={onRemove}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {question !== undefined && typeof question.kind === 'object' && (
        <fieldset className="flex min-w-0 flex-wrap gap-2">
          <legend className="sr-only">{`${name}: the answer is any of`}</legend>
          {question.kind.choice.options.filter((o: string) => o.trim() !== '').map((o: string) => (
            <label key={o} className={CHIP}>
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={values.includes(o)} onChange={(e): void => choose(o, e.target.checked)} />
              {o}
            </label>
          ))}
        </fieldset>
      )}
      {question !== undefined && typeof question.kind !== 'object' && (
        <div className="flex min-w-0 flex-wrap gap-2">
          <NativeSelect aria-label={`${name}: test`} className="w-full sm:w-auto" value={contains ? 'contains' : 'is'}
            onChange={(e): void => onChange(text(e.target.value === 'contains' ? 'contains' : 'is', values[0] ?? ''))}>
            <option value="is">is</option>
            <option value="contains">contains</option>
          </NativeSelect>
          <Input aria-label={`${name}: text`} className="h-[44px] w-full min-w-0 sm:w-auto sm:flex-1" value={values[0] ?? ''}
            onChange={(e): void => onChange(text(contains ? 'contains' : 'is', e.target.value))} />
        </div>
      )}
    </div>
  );
}
