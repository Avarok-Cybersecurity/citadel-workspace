/**
 * Polls and routing forms over the real ports and core (design §3.6.3): each member's vote is in
 * their own namespace and the tally reads every author's; a pick turns the poll into the host's
 * event inviting who could make it, once; a routing form is saved only when it holds together and
 * routes a booker's answers by its first rule that holds.
 */
import { describe, expect, it } from 'vitest';
import { CalendarRefusal } from '../engine/calendar-engine';
import type { Poll } from '../generated/Poll';
import type { RoutingForm } from '../generated/RoutingForm';
import { castVote, pickProposal, readPoll, savePoll, tallyOf } from '../polls';
import { readRoutingForms, routeAnswers, saveRoutingForm } from '../routing-forms';
import { engine, member, NOW, type Member } from './booking-rig';
import { utc } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { PollTally } from '@/lib/calendar/engine/team-engine';
import type { Event } from '../generated/Event';

const hour = (h: number): { start_ms: bigint; end_ms: bigint; } => ({ start_ms: utc(`2024-07-16T${h}:00:00Z`), end_ms: utc(`2024-07-16T${h}:30:00Z`) });
const POLL: Poll = { id: 'p1', type_id: 'plan', host: 'ana', title: 'Planning', zone: 'America/New_York', proposals: [hour(13), hour(15), hour(17)], state: 'open' };

async function members(): Promise<{ shared: Map<string, Uint8Array>; m: (name: string) => Member }> {
  const relay: IhttpRelay = new IhttpRelay();
  const shared: Map<string, Uint8Array> = new Map();
  const all: Map<string, Member> = new Map();
  for (const name of ['ana', 'bo', 'cy']) all.set(name, await member(name, relay, shared));
  return { shared, m: (name: string): Member => all.get(name) as Member };
}

describe('polls', () => {
  it('tallies every member’s own vote, and a pick makes the event once, inviting who could make it', async () => {
    const { shared, m } = await members();
    await savePoll(m('ana').ports, engine, 'n1', POLL);
    await castVote(m('bo').ports, engine, 'n1', 'bo', POLL, { poll_id: 'p1', yes: [1], maybe: [0] });
    await castVote(m('cy').ports, engine, 'n1', 'cy', POLL, { poll_id: 'p1', yes: [1, 2], maybe: [] });
    const tally: PollTally = await tallyOf(m('ana').ports, engine, 'n1', POLL);
    expect(tally.leading).toBe(1);
    expect(tally.tallies[1]?.yes).toEqual(['bo', 'cy']);
    const made: Event = await pickProposal(m('ana').ports, engine, POLL, 1, { node: 'n1', eventId: 'e-plan', nowMs: NOW });
    expect(made).toMatchObject({ when: { once: hour(15) }, hosts: ['ana'], invitees: [{ member: { username: 'bo' } }, { member: { username: 'cy' } }] });
    expect(shared.has('authored:n1:ana|cal/event/e-plan')).toBe(true);
    const picked: Poll | null = await readPoll(m('bo').ports, engine, 'n1', 'ana', 'p1');
    expect(picked?.state).toEqual({ picked: { proposal: 1, event_id: 'e-plan' } });
    await expect(pickProposal(m('ana').ports, engine, picked as Poll, 0, { node: 'n1', eventId: 'e2', nowMs: NOW })).rejects.toBeInstanceOf(CalendarRefusal);
    await expect(castVote(m('bo').ports, engine, 'n1', 'bo', picked as Poll, { poll_id: 'p1', yes: [0], maybe: [] })).rejects.toMatchObject({ code: 'not_open' });
  });

  it('refuses a vote that names a proposal twice, and a poll whose proposals overlap', async () => {
    const { m } = await members();
    await expect(castVote(m('bo').ports, engine, 'n1', 'bo', POLL, { poll_id: 'p1', yes: [0], maybe: [0] })).rejects.toMatchObject({ code: 'bad_vote' });
    const overlapping: Poll = { ...POLL, proposals: [hour(13), { start_ms: hour(13).start_ms + 1n, end_ms: hour(15).end_ms }] };
    await expect(savePoll(m('ana').ports, engine, 'n1', overlapping)).rejects.toMatchObject({ code: 'bad_proposals' });
  });
});

const FORM: RoutingForm = {
  id: 'sales', name: 'Talk to us', questions: [{ id: 'size', label: 'Team size', kind: { choice: { options: ['Small', 'Large'] } }, required: true }],
  rules: [{ when: [{ question_id: 'size', test: { is: { value: 'Large' } } }], target: { team_type: { node_id: 'n1', type_id: 'team' } } }],
  fallback: { member: { username: 'ana', slug: 'n1' } },
};

describe('routing forms', () => {
  it('saves a form that holds together and routes answers by its first rule that holds', async () => {
    const { m } = await members();
    await saveRoutingForm(m('ana').ports, engine, 'n1', FORM);
    const { forms } = await readRoutingForms(m('bo').ports, engine, 'n1');
    expect(forms).toEqual([FORM]);
    expect(routeAnswers(engine, FORM, [{ question_id: 'size', value: 'large' }])).toEqual({ team_type: { node_id: 'n1', type_id: 'team' } });
    expect(routeAnswers(engine, FORM, [{ question_id: 'size', value: 'Small' }])).toEqual(FORM.fallback);
    expect(() => routeAnswers(engine, FORM, [])).toThrow(CalendarRefusal);
  });

  it('refuses to save a form whose rule names an option the question does not offer', async () => {
    const { m, shared } = await members();
    const bad: RoutingForm = { ...FORM, rules: [{ ...FORM.rules[0]!, when: [{ question_id: 'size', test: { is: { value: 'Huge' } } }] }] };
    await expect(saveRoutingForm(m('ana').ports, engine, 'n1', bad)).rejects.toMatchObject({ code: 'bad_form' });
    expect([...shared.keys()].some((k) => k.includes('cal/routing/'))).toBe(false);
  });
});
