/**
 * Editing a node's routing form (design §3.6.3), pure: a form being edited is a `RoutingForm`
 * whose targets may still be unchosen (an empty name or id), so nothing is invented for the
 * editor; `formErrors` says what is missing, field by field, and then asks the core whether the
 * form holds together (`check_form`), whose word is final. A target is a member or a team type on
 * this node, or another node, which the booker is sent to as a link.
 */
import { CalendarRefusal, type CalendarEngine } from './engine/calendar-engine';
import type { AnswerTest } from './generated/AnswerTest';
import type { Condition } from './generated/Condition';
import type { Question } from './generated/Question';
import type { RoutingForm } from './generated/RoutingForm';
import type { RoutingRule } from './generated/RoutingRule';
import type { RoutingTarget } from './generated/RoutingTarget';

export type TargetKind = 'member' | 'team_type' | 'node';
export const TARGET_KINDS: readonly TargetKind[] = ['member', 'team_type', 'node'];

export const targetKind = (t: RoutingTarget): TargetKind => ('member' in t ? 'member' : 'team_type' in t ? 'team_type' : 'node');

/** A target of `kind` with nothing chosen yet; one on this node names it. */
export function unchosen(kind: TargetKind, node: string): RoutingTarget {
  if (kind === 'member') return { member: { username: '', slug: node } };
  if (kind === 'team_type') return { team_type: { node_id: node, type_id: '' } };
  return { node: { node_id: '' } };
}

export const blankForm = (id: string, node: string): RoutingForm => ({ id, name: '', questions: [], rules: [], fallback: unchosen('member', node) });

/** A condition on `question`, its test still to be filled in: one of a choice's options, or a text. */
export const blankCondition = (question: Question): Condition => ({
  question_id: question.id, test: typeof question.kind === 'object' ? { is_one_of: { values: [] } } : { is: { value: '' } },
});

export const blankRule = (question: Question, node: string): RoutingRule => ({ when: [blankCondition(question)], target: unchosen('member', node) });

/** `rules` with the rule at `index` moved one place up (-1) or down (1); unchanged at either end. */
export function moveRule(rules: readonly RoutingRule[], index: number, by: -1 | 1): RoutingRule[] {
  const to: number = index + by;
  if (index < 0 || index >= rules.length || to < 0 || to >= rules.length) return [...rules];
  const next: RoutingRule[] = [...rules];
  [next[index], next[to]] = [next[to] as RoutingRule, next[index] as RoutingRule];
  return next;
}

/** The options a choice condition names, or a text condition's text. */
export function testValues(test: AnswerTest): string[] {
  if ('is_one_of' in test) return test.is_one_of.values;
  return ['is' in test ? test.is.value : test.contains.text];
}

function targetError(t: RoutingTarget): string | null {
  if ('member' in t) return t.member.username === '' ? 'Choose a member.' : null;
  if ('team_type' in t) return t.team_type.type_id === '' ? 'Choose a team type.' : null;
  return t.node.node_id.trim() === '' ? "Enter the node's id." : null;
}

function conditionError(c: Condition): string | null {
  const values: string[] = testValues(c.test).map((v: string) => v.trim());
  return values.length === 0 || values.some((v: string) => v === '') ? 'Say what the answer must be.' : null;
}

const trimmed = (t: RoutingTarget): RoutingTarget => ('node' in t ? { node: { node_id: t.node.node_id.trim() } } : t);

/** The form as it is saved: its name and node ids trimmed. */
export const formToSave = (form: RoutingForm): RoutingForm => ({
  ...form, name: form.name.trim(), fallback: trimmed(form.fallback), rules: form.rules.map((r: RoutingRule) => ({ ...r, target: trimmed(r.target) })),
});

/** Keyed `name`, `fallback`, `rule-<i>` and `form` (the core's verdict); empty when it may be saved. */
export function formErrors(form: RoutingForm, engine: Pick<CalendarEngine, 'team'>): Map<string, string> {
  const errors: Map<string, string> = new Map();
  if (form.name.trim() === '') errors.set('name', 'Give the form a name.');
  if (form.questions.some((q: Question) => q.label.trim() === '')) errors.set('questions', 'Every question needs a label.');
  const fallback: string | null = targetError(form.fallback);
  if (fallback !== null) errors.set('fallback', fallback);
  form.rules.forEach((rule: RoutingRule, i: number): void => {
    const said: string | null = rule.when.map(conditionError).find((e) => e !== null) ?? targetError(rule.target);
    if (said !== null) errors.set(`rule-${i}`, said);
  });
  if (errors.size > 0) return errors;
  try {
    engine.team.checkRoutingForm(formToSave(form));
  } catch (e: unknown) {
    if (!(e instanceof CalendarRefusal)) throw e;
    errors.set('form', e.detail ?? e.message);
  }
  return errors;
}
