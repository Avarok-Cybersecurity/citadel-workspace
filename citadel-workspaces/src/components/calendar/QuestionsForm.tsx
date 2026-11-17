/**
 * The invitee's answers to an event type's questions (design §3.1 "Invitee questions"): a labelled
 * field per question, the required ones marked in words, and each error beside its field and tied
 * to it (`aria-describedby`), as `checkAnswers` (booking-form.ts) reports them.
 */
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Question } from '@/lib/calendar/generated/Question';
import { NativeSelect } from './NativeSelect';

interface QuestionsFormProps {
  questions: readonly Question[];
  values: ReadonlyMap<string, string>;
  errors: ReadonlyMap<string, string>;
  /** What the questions are, said once above them: "Your details". */
  legend: string;
  onChange: (questionId: string, value: string) => void;
}

const FIELD: string = 'min-h-[44px] w-full';

function Field({ q, id, value, invalid, describedBy, onChange }: { q: Question; id: string; value: string; invalid: boolean; describedBy: string | undefined; onChange: (v: string) => void }): JSX.Element {
  const common: { id: string; required: boolean; 'aria-invalid': boolean; 'aria-describedby': string | undefined; } = { id, required: q.required, 'aria-invalid': invalid, 'aria-describedby': describedBy };
  if (q.kind === 'text') return <Input {...common} className={FIELD} value={value} onChange={(e): void => onChange(e.target.value)} />;
  if (q.kind === 'long_text') return <Textarea {...common} className={FIELD} rows={3} value={value} onChange={(e): void => onChange(e.target.value)} />;
  return (
    <NativeSelect {...common} className="w-full" value={value} onChange={(e): void => onChange(e.target.value)}>
      <option value="">{q.required ? 'Choose one' : 'No answer'}</option>
      {q.kind.choice.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
    </NativeSelect>
  );
}

export function QuestionsForm({ questions, values, errors, legend, onChange }: QuestionsFormProps): JSX.Element | null {
  const base: string = useId();
  if (questions.length === 0) return null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="calendar-questions">
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      {questions.map((q: Question, i: number) => {
        const id: string = `${base}-q${i}`;
        const error: string | undefined = errors.get(q.id);
        return (
          <div key={q.id} className="flex min-w-0 flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-foreground">
              {q.label}
              <span className="font-normal text-muted-foreground">{q.required ? ' (required)' : ' (optional)'}</span>
            </label>
            <Field q={q} id={id} value={values.get(q.id) ?? ''} invalid={error !== undefined} describedBy={error === undefined ? undefined : `${id}-error`} onChange={(v: string): void => onChange(q.id, v)} />
            {error !== undefined && <p id={`${id}-error`} className="text-sm text-destructive-emphasis">{error}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
