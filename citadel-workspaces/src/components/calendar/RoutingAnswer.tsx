/**
 * Answering a node's routing form on its booking page (design §3.6.3): the form's questions, the
 * answers checked as a type's are (booking-form.ts), and the core's route to a member, a team type
 * or another page. Where the booker goes is the caller's: this only says where the answers lead.
 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { checkAnswers, type FormCheck } from '@/lib/calendar/booking-form';
import { CalendarRefusal, type CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { RoutingForm } from '@/lib/calendar/generated/RoutingForm';
import type { RoutingTarget } from '@/lib/calendar/generated/RoutingTarget';
import { routeAnswers } from '@/lib/calendar/routing-forms';
import { QuestionsForm } from './QuestionsForm';

interface RoutingAnswerProps {
  engine: CalendarEngine;
  forms: readonly RoutingForm[];
  onRouted: (target: RoutingTarget) => void;
}

export function RoutingAnswer({ engine, forms, onRouted }: RoutingAnswerProps): JSX.Element | null {
  const heading: string = useId();
  const [formId, setFormId] = useState<string | null>(forms[0]?.id ?? null);
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [said, setSaid] = useState<string>('');
  const form: RoutingForm | undefined = forms.find((f: RoutingForm) => f.id === formId);
  if (form === undefined) return null;

  const route = (): void => {
    const checked: FormCheck = checkAnswers(form.questions, values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSaid('Some answers need attention.');
      return;
    }
    setErrors(new Map());
    try {
      onRouted(routeAnswers(engine, form, checked.answers));
      setSaid('');
    } catch (e: unknown) {
      if (!(e instanceof CalendarRefusal)) throw e;
      setSaid(`These answers lead nowhere yet: ${e.message}.`);
    }
  };
  return (
    <section aria-labelledby={heading} className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" data-testid="calendar-routing-form">
      <h3 id={heading} className="text-sm font-semibold text-foreground">Not sure whom to book? Answer a few questions</h3>
      {forms.length > 1 && (
        <div role="group" aria-label="Questions about" className="flex min-w-0 flex-wrap gap-2">
          {forms.map((f: RoutingForm) => (
            <Button key={f.id} variant={f.id === form.id ? 'default' : 'outline'} aria-pressed={f.id === form.id} className="h-[44px]"
              onClick={(): void => { setFormId(f.id); setValues(new Map()); setErrors(new Map()); }}>{f.name}</Button>
          ))}
        </div>
      )}
      {forms.length === 1 && <p className="text-sm text-muted-foreground">{form.name}</p>}
      <QuestionsForm questions={form.questions} values={values} errors={errors} legend="Your answers" onChange={(id: string, v: string): void => setValues(new Map(values).set(id, v))} />
      <Button className="h-[44px] self-start" onClick={route}>Find whom to book</Button>
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </section>
  );
}
