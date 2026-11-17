/**
 * Editing a routing form, pure, over the real core: rules move one place at a time and not past
 * either end; every unchosen target and empty test is said by field; and once those are filled
 * the core's own check has the last word.
 */
import { describe, expect, it } from 'vitest';
import type { Question } from '../generated/Question';
import type { RoutingForm } from '../generated/RoutingForm';
import type { RoutingRule } from '../generated/RoutingRule';
import { blankForm, blankRule, formErrors, moveRule, unchosen } from '../routing-form-draft';
import { realEngine } from './engine-rig';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const TOPIC: Question = { id: 'q', label: 'Topic', kind: { choice: { options: ['Sales', 'Support'] } }, required: true };
const to = (username: string): { member: { username: string; slug: string; }; } => ({ member: { username, slug: 'n1' } });

describe('editing a routing form', () => {
  it('moves a rule one place, and not past either end', () => {
    const rules: RoutingRule[] = ['a', 'b', 'c'].map((u: string) => ({ ...blankRule(TOPIC, 'n1'), target: to(u) }));
    const order = (r: RoutingRule[]): string[] => r.map((x) => ('member' in x.target ? x.target.member.username : ''));
    expect(order(moveRule(rules, 2, -1))).toEqual(['a', 'c', 'b']);
    expect(order(moveRule(rules, 0, 1))).toEqual(['b', 'a', 'c']);
    expect(order(moveRule(rules, 0, -1))).toEqual(['a', 'b', 'c']);
    expect(order(moveRule(rules, 2, 1))).toEqual(['a', 'b', 'c']);
  });

  it('says what is missing, field by field, then lets the core judge', () => {
    const blank: RoutingForm = { ...blankForm('f1', 'n1'), questions: [TOPIC], rules: [blankRule(TOPIC, 'n1')] };
    expect(Object.fromEntries(formErrors(blank, engine))).toEqual({ name: 'Give the form a name.', fallback: 'Choose a member.', 'rule-0': 'Say what the answer must be.' });
    const filled: RoutingForm = { ...blank, name: 'Triage', fallback: unchosen('node', 'n1'), rules: [{ when: [{ question_id: 'q', test: { is_one_of: { values: ['Sales'] } } }], target: to('bo') }] };
    expect(Object.fromEntries(formErrors(filled, engine))).toEqual({ fallback: "Enter the node's id." });
    const ready: RoutingForm = { ...filled, fallback: { node: { node_id: 'n9' } } };
    expect(formErrors(ready, engine).size).toBe(0);
    expect(formErrors({ ...ready, questions: [] }, engine).get('form')).toMatch(/does not ask/);
  });
});
