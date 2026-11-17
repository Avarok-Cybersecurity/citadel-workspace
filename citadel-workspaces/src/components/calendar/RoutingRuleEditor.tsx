/**
 * One rule of a routing form (design §3.6.3): its conditions, every one of which must hold, and
 * where it sends the booker. Rules are tried in order, so each can be moved up or down; the
 * buttons are always shown, never only on hover.
 */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Condition } from '@/lib/calendar/generated/Condition';
import type { EventType } from '@/lib/calendar/generated/EventType';
import type { Question } from '@/lib/calendar/generated/Question';
import type { RoutingRule } from '@/lib/calendar/generated/RoutingRule';
import { blankCondition } from '@/lib/calendar/routing-form-draft';
import { RoutingCondition } from './RoutingCondition';
import { RoutingTargetPicker } from './RoutingTargetPicker';

interface RoutingRuleEditorProps {
  index: number;
  count: number;
  rule: RoutingRule;
  questions: readonly Question[];
  node: { id: string; name: string };
  members: readonly string[];
  teams: readonly EventType[];
  error: string | undefined;
  onChange: (next: RoutingRule) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

const ICON: string = 'h-[44px] w-[44px] shrink-0';

export function RoutingRuleEditor(p: RoutingRuleEditorProps): JSX.Element {
  const { index, count, rule, questions, onChange } = p;
  const name: string = `Rule ${index + 1}`;
  const setCondition = (i: number, next: Condition | null): void =>
    onChange({ ...rule, when: next === null ? rule.when.filter((_c, j: number) => j !== i) : rule.when.map((c: Condition, j: number) => (j === i ? next : c)) });
  const first: Question | undefined = questions[0];
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" data-testid="calendar-routing-rule">
      <div className="flex min-w-0 items-center gap-1">
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{name}</h4>
        <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Move ${name.toLowerCase()} up`} disabled={index === 0} onClick={(): void => p.onMove(-1)}>
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Move ${name.toLowerCase()} down`} disabled={index === count - 1} onClick={(): void => p.onMove(1)}>
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={ICON} aria-label={`Remove ${name.toLowerCase()}`} onClick={p.onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">When every one of these holds:</p>
      {rule.when.map((c: Condition, i: number) => (
        <RoutingCondition key={i} name={`${name}, condition ${i + 1}`} condition={c} questions={questions}
          onChange={(next: Condition): void => setCondition(i, next)} onRemove={rule.when.length > 1 ? (): void => setCondition(i, null) : null} />
      ))}
      {first !== undefined && (
        <Button type="button" variant="outline" className="h-[44px] self-start" onClick={(): void => onChange({ ...rule, when: [...rule.when, blankCondition(first)] })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add a condition</span>
        </Button>
      )}
      <RoutingTargetPicker legend={`${name} sends the booker to`} target={rule.target} node={p.node} members={p.members} teams={p.teams} error={undefined}
        onChange={(target): void => onChange({ ...rule, target })} />
      {p.error !== undefined && <p role="alert" className="text-sm text-destructive-emphasis">{name}: {p.error}</p>}
    </li>
  );
}
