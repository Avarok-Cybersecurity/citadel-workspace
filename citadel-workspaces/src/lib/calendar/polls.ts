/**
 * Polls on a node (design §3.6.3). The poll is its host's (`cal/poll/<id>` in their authored
 * namespace); each member's vote is their own (`cal/poll-vote/<id>` in theirs), so the kernel's
 * author stamp is what says who voted, and no one votes for another. The tally is read from every
 * author's vote and computed by the core, never stored. Picking a proposal turns the poll into the
 * host's event on the node, with everyone who said yes or maybe invited.
 */
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';
import type { CalendarEngine } from './engine/calendar-engine';
import type { PollTally } from './engine/team-engine';
import type { Event } from './generated/Event';
import type { Interval } from './generated/Interval';
import type { Poll } from './generated/Poll';
import type { PollVote } from './generated/PollVote';
import type { CalendarPorts, CalendarStore } from './ports';
import { EVENT_PREFIX } from './read-sources';
import type { ProposalTally } from './generated/ProposalTally';

export const POLL_PREFIX: string = 'cal/poll/';
export const VOTE_PREFIX: string = 'cal/poll-vote/';

const authored = (node: string, author: string): CalendarStore => ({ kind: 'authored', node, author });

/** Saves `poll` as its host's, once the core accepts its proposals. */
export async function savePoll(ports: CalendarPorts, engine: CalendarEngine, node: string, poll: Poll): Promise<void> {
  engine.team.checkPoll(poll);
  await ports.storage.set(authored(node, poll.host), `${POLL_PREFIX}${poll.id}`, engine.team.encodePoll(poll));
}

export async function readPoll(ports: CalendarPorts, engine: CalendarEngine, node: string, host: string, id: string): Promise<Poll | null> {
  const bytes: Uint8Array | null = await ports.storage.get(authored(node, host), `${POLL_PREFIX}${id}`);
  return bytes === null ? null : engine.team.decodePoll(bytes);
}

/** Every poll on `node`, by every host, by title; a value that will not decode is counted, not shown. */
export async function listPolls(ports: CalendarPorts, engine: CalendarEngine, node: string): Promise<{ polls: Poll[]; unreadable: number }> {
  const keys: AuthoredKey[] = await ports.storage.authoredKeys(node, POLL_PREFIX);
  const polls: Poll[] = [];
  let unreadable: number = 0;
  for (const k of keys) {
    const bytes: Uint8Array | null = await ports.storage.get(authored(node, k.author), k.key);
    if (bytes === null) continue;
    try {
      const poll: Poll = engine.team.decodePoll(bytes);
      if (poll.host === k.author) polls.push(poll);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { polls: polls.sort((a: Poll, b: Poll): number => a.title.localeCompare(b.title)), unreadable };
}

/** `me`'s own vote on poll `id`, or null before they voted. */
export async function readVote(ports: CalendarPorts, engine: CalendarEngine, node: string, me: string, id: string): Promise<PollVote | null> {
  const bytes: Uint8Array | null = await ports.storage.get(authored(node, me), `${VOTE_PREFIX}${id}`);
  return bytes === null ? null : engine.team.decodePollVote(bytes);
}

/** Casts `me`'s vote, replacing any earlier one, once the core accepts it for this poll. */
export async function castVote(ports: CalendarPorts, engine: CalendarEngine, node: string, me: string, poll: Poll, vote: PollVote): Promise<void> {
  engine.team.checkVote(poll, vote);
  await ports.storage.set(authored(node, me), `${VOTE_PREFIX}${poll.id}`, engine.team.encodePollVote(vote));
}

/** Every author's vote on `poll`, tallied; a vote that will not decode counts for nothing. */
export async function tallyOf(ports: CalendarPorts, engine: CalendarEngine, node: string, poll: Poll): Promise<PollTally> {
  const key: string = `${VOTE_PREFIX}${poll.id}`;
  const keys: AuthoredKey[] = (await ports.storage.authoredKeys(node, key)).filter((k) => k.key === key);
  const votes: [string, PollVote][] = [];
  for (const k of keys) {
    const bytes: Uint8Array | null = await ports.storage.get(authored(node, k.author), key);
    if (bytes === null) continue;
    try {
      votes.push([k.author, engine.team.decodePollVote(bytes)]);
    } catch {
      // Counted for nothing, as the core counts a vote that does not pass.
    }
  }
  return engine.team.tally(poll, votes);
}

export interface PickContext {
  readonly node: string;
  readonly eventId: string;
  readonly nowMs: bigint;
}

/**
 * The host picks `proposal`: the poll is marked picked and its event written, in one write of the
 * host's own namespace, inviting everyone who could make it.
 */
export async function pickProposal(ports: CalendarPorts, engine: CalendarEngine, poll: Poll, proposal: number, ctx: PickContext): Promise<Event> {
  const [picked, slot]: [Poll, Interval] = engine.team.pick(poll, proposal, ctx.eventId);
  const { tallies } = await tallyOf(ports, engine, ctx.node, poll);
  const chosen: ProposalTally = tallies[proposal];
  const invited: string[] = chosen === undefined ? [] : [...chosen.yes, ...chosen.maybe].filter((u: string) => u !== poll.host);
  const event: Event = {
    id: ctx.eventId, rev: 1, origin_node: ctx.node, author: poll.host, title: poll.title, body: null, kind: 'plain', status: 'confirmed',
    when: { once: { start_ms: slot.start_ms, end_ms: slot.end_ms } }, zone: poll.zone, location: 'in_app', hosts: [poll.host],
    invitees: invited.map((username: string) => ({ member: { username } })), visibility: 'public', propagate: { down: false, up_to: null },
    reminders: [], notes_doc: null, source: null, created_ms: ctx.nowMs, updated_ms: ctx.nowMs,
  };
  await ports.storage.setMany(authored(ctx.node, poll.host), [
    { key: `${POLL_PREFIX}${poll.id}`, value: engine.team.encodePoll(picked) },
    { key: `${EVENT_PREFIX}${ctx.eventId}`, value: engine.encodeEvent(event) },
  ]);
  return event;
}
