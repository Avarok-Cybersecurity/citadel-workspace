/**
 * What the poll screens decide (design §3.6.3): a new poll from the times its host typed, in their
 * zone and one of their poll type's lengths, checked by the core (`check_poll`: some, at most
 * twenty, none overlapping) rather than again here; and a member's vote from a yes, maybe or no
 * per proposed time, a "no" being a proposal the vote does not name.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import { CalendarRefusal } from './engine/call';
import type { Interval } from './generated/Interval';
import type { Poll } from './generated/Poll';
import type { PollVote } from './generated/PollVote';

export type Reply = 'yes' | 'maybe' | 'no';

export function voteOf(pollId: string, replies: ReadonlyMap<number, Reply>): PollVote {
  const named = (r: Reply): number[] => [...replies].filter(([, v]) => v === r).map(([i]) => i).sort((a: number, b: number) => a - b);
  return { poll_id: pollId, yes: named('yes'), maybe: named('maybe') };
}

export function repliesOf(vote: PollVote | null, proposals: number): Map<number, Reply> {
  const replies: Map<number, Reply> = new Map(Array.from({ length: proposals }, (_, i: number): [number, Reply] => [i, 'no']));
  for (const i of vote?.yes ?? []) replies.set(i, 'yes');
  for (const i of vote?.maybe ?? []) replies.set(i, 'maybe');
  return replies;
}

/** One proposed time as typed: `yyyy-mm-dd` and `hh:mm`, in the host's zone. */
export interface ProposalDraft {
  readonly date: string;
  readonly time: string;
}

export interface PollDraft {
  readonly title: string;
  /** One of the host's poll types on the node; null until chosen. */
  readonly typeId: string | null;
  readonly durationMin: number | null;
  readonly proposals: readonly ProposalDraft[];
}

export interface PollIdentity {
  readonly id: string;
  readonly host: string;
  readonly zone: string;
}

export type PollCheck = { ok: true; poll: Poll } | { ok: false; errors: ReadonlyMap<string, string> };

const DATE: RegExp = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME: RegExp = /^(\d{2}):(\d{2})$/;

/** Error keys: title, type, proposal-<i>, proposals. */
export function checkPollDraft(draft: PollDraft, who: PollIdentity, engine: Pick<CalendarEngine, 'instantOf' | 'team'>): PollCheck {
  const errors: Map<string, string> = new Map();
  if (draft.title.trim() === '') errors.set('title', 'Give the poll a title.');
  if (draft.typeId === null || draft.durationMin === null) errors.set('type', 'Choose which of your poll types this is, and how long.');
  const proposals: Interval[] = [];
  draft.proposals.forEach((p: ProposalDraft, i: number): void => {
    const d: RegExpExecArray | null = DATE.exec(p.date);
    const t: RegExpExecArray | null = TIME.exec(p.time);
    if (d === null || t === null) {
      errors.set(`proposal-${i}`, `Time ${i + 1} needs a date and a time.`);
      return;
    }
    const start: bigint = engine.instantOf(who.zone, { date: { y: Number(d[1]), m: Number(d[2]), d: Number(d[3]) }, minute: Number(t[1]) * 60 + Number(t[2]) });
    if (draft.durationMin !== null) proposals.push({ start_ms: start, end_ms: start + BigInt(draft.durationMin * 60_000) });
  });
  if (draft.proposals.length === 0) errors.set('proposals', 'Propose at least one time.');
  proposals.sort((a: Interval, b: Interval): number => (a.start_ms < b.start_ms ? -1 : a.start_ms > b.start_ms ? 1 : 0));
  if (errors.size > 0 || draft.typeId === null) return { ok: false, errors };
  const poll: Poll = { id: who.id, type_id: draft.typeId, host: who.host, title: draft.title.trim(), zone: who.zone, proposals, state: 'open' };
  try {
    engine.team.checkPoll(poll);
  } catch (e: unknown) {
    if (!(e instanceof CalendarRefusal)) throw e;
    return { ok: false, errors: new Map([['proposals', 'The times must not overlap, and a poll proposes at most 20.']]) };
  }
  return { ok: true, poll };
}
