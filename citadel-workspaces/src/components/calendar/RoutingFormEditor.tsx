/**
 * The routing-form editor (design §3.6.3): a form's name, the questions it asks, its rules in the
 * order they are tried, and where a booker goes when none holds. It is checked before `onSave`
 * (routing-form-draft.ts, then the core's `check_form`), each error under what it is about.
 */
import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { Question } from '@/lib/calendar/generated/Question';
import type { RoutingForm } from '@/lib/calendar/generated/RoutingForm';
import type { RoutingRule } from '@/lib/calendar/generated/RoutingRule';
import { blankForm, blankRule, formErrors, formToSave, moveRule } from '@/lib/calendar/routing-form-draft';
import { QuestionsEditor } from './QuestionsEditor';
import { RoutingRuleEditor } from './RoutingRuleEditor';
import { RoutingTargetPicker } from './RoutingTargetPicker';

interface RoutingFormEditorProps {
  engine: CalendarEngine;
  id: string;
  saved: RoutingForm | null;
  node: { id: string; name: string };
  members: readonly string[];
  teams: readonly EventType[];
  newId: () => string;
  onSave: (form: RoutingForm) => Promise<string | null>;
  onCancel: () => void;
}

export function RoutingFormEditor(p: RoutingFormEditorProps): JSX.Element {
  const base: string = useId();
  const [form, setForm] = useState<RoutingForm>(p.saved ?? blankForm(p.id, p.node.id));
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState<boolean>(false);
  const [said, setSaid] = useState<string>('');
  const setRules = (rules: RoutingRule[]): void => setForm({ ...form, rules });
  const first: Question | undefined = form.questions[0];
  const nameError: string | undefined = errors.get('name');

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const found: Map<string, string> = formErrors(form, p.engine);
    setErrors(found);
    if (found.size > 0) {
      setSaid('Some fields need attention.');
      return;
    }
    setSaving(true);
    const ready: RoutingForm = formToSave(form);
    const failed: string | null = await p.onSave(ready);
    setSaving(false);
    setSaid(failed === null ? `Saved ${ready.name}.` : `Not saved: ${failed}.`);
  };
  return (
    <form onSubmit={(e): void => { void save(e); }} className="flex min-w-0 flex-col gap-4" data-testid="calendar-routing-form-editor" aria-label={p.saved === null ? 'New routing form' : `Edit ${p.saved.name}`}>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${base}-name`} className="text-sm font-medium text-foreground">Form name</label>
        <Input id={`${base}-name`} className="h-[44px]" value={form.name} aria-invalid={nameError !== undefined} aria-describedby={nameError === undefined ? undefined : `${base}-name-error`}
          onChange={(e): void => setForm({ ...form, name: e.target.value })} />
        {nameError !== undefined && <p id={`${base}-name-error`} className="text-sm text-destructive-emphasis">{nameError}</p>}
      </div>
      <QuestionsEditor questions={form.questions} errors={new Map()} newId={p.newId} onChange={(questions: Question[]): void => setForm({ ...form, questions })} />
      {errors.has('questions') && <p role="alert" className="text-sm text-destructive-emphasis">{errors.get('questions')}</p>}
      <section aria-labelledby={`${base}-rules`} className="flex min-w-0 flex-col gap-2">
        <h4 id={`${base}-rules`} className="text-sm font-semibold text-foreground">Rules, tried in order</h4>
        {form.rules.length === 0 && <p className="text-sm text-muted-foreground">None: every booker goes where the form sends anyone else.</p>}
        <ol className="flex min-w-0 flex-col gap-2">
          {form.rules.map((rule: RoutingRule, i: number) => (
            <RoutingRuleEditor
              key={i} index={i} count={form.rules.length} rule={rule} questions={form.questions} node={p.node} members={p.members} teams={p.teams} error={errors.get(`rule-${i}`)}
              onChange={(next: RoutingRule): void => setRules(form.rules.map((r: RoutingRule, j: number) => (j === i ? next : r)))}
              onMove={(by: -1 | 1): void => setRules(moveRule(form.rules, i, by))}
              onRemove={(): void => setRules(form.rules.filter((_r, j: number) => j !== i))}
            />
          ))}
        </ol>
        {first === undefined ? (
          <p className="text-sm text-muted-foreground">Add a question first: a rule tests its answer.</p>
        ) : (
          <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => setRules([...form.rules, blankRule(first, p.node.id)])}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add a rule</span>
          </Button>
        )}
      </section>
      <RoutingTargetPicker legend="Anyone else goes to" target={form.fallback} node={p.node} members={p.members} teams={p.teams} error={errors.get('fallback')}
        onChange={(fallback): void => setForm({ ...form, fallback })} />
      {errors.has('form') && <p role="alert" className="text-sm text-destructive-emphasis">The form does not hold together: {errors.get('form')}.</p>}
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="submit" className="h-[44px]" disabled={saving}>Save routing form</Button>
        <Button type="button" variant="outline" className="h-[44px]" onClick={p.onCancel}>Close</Button>
      </div>
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </form>
  );
}
