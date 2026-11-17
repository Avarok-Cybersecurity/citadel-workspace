/**
 * What the poll screens decide, over the real ports and core: the panel lists every member's poll
 * and leaves out one written under another member's name; a vote's yes, maybe and no survive the
 * round trip; and a new poll's typed times become the host's zone's instants, in order, the core
 * refusing overlapping ones.
 */
import { describe, expect, it } from 'vitest';
import type { Poll } from '../generated/Poll';
import { checkPollDraft, repliesOf, voteOf, type PollDraft } from '../poll-draft';
import { listPolls, POLL_PREFIX, savePoll } from '../polls';
import { engine, member } from './booking-rig';
import { NY, utc } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { PollCheck } from '@/lib/calendar/poll-draft';
import type { PollVote } from '@/lib/calendar/generated/PollVote';
import type { Member } from '@/lib/calendar/__tests__/booking-rig';

const half = (iso: string): { start_ms: bigint; end_ms: bigint; } => ({ start_ms: utc(iso), end_ms: utc(iso) + 1_800_000n });
const POLL: Poll = { id: 'p1', type_id: 'plan', host: 'ana', title: 'Planning', zone: NY, proposals: [half('2024-07-16T13:00:00Z')], state: 'open' };
const draft: PollDraft = { title: ' Planning ', typeId: 'plan', durationMin: 30, proposals: [{ date: '2024-07-17', time: '09:00' }, { date: '2024-07-16', time: '14:30' }] };
const who: { id: string; host: string; zone: string; } = { id: 'p2', host: 'ana', zone: NY };

describe('the poll screens', () => {
  it("list every member's poll, and not one written under another member's name", async () => {
    const relay: IhttpRelay = new IhttpRelay();
    const shared: Map<string, Uint8Array> = new Map();
    const ana: Member = await member('ana', relay, shared);
    const bo: Member = await member('bo', relay, shared);
    await savePoll(ana.ports, engine, 'n1', POLL);
    await bo.ports.storage.set({ kind: 'authored', node: 'n1', author: 'bo' }, `${POLL_PREFIX}forged`, engine.team.encodePoll({ ...POLL, id: 'forged' }));
    const listed: { polls: Poll[]; unreadable: number; } = await listPolls(bo.ports, engine, 'n1');
    expect(listed.polls.map((p: Poll) => `${p.host}/${p.id}`)).toEqual(['ana/p1']);
    expect(listed.unreadable).toBe(1);
  });

  it("keeps a member's yes, maybe and no through their vote", () => {
    const replies: Map<number, "maybe" | "no" | "yes"> = new Map([[0, 'maybe' as const], [1, 'no' as const], [2, 'yes' as const]]);
    const vote: PollVote = voteOf('p1', replies);
    expect(vote).toEqual({ poll_id: 'p1', yes: [2], maybe: [0] });
    expect(repliesOf(vote, 3)).toEqual(replies);
    expect(repliesOf(null, 2)).toEqual(new Map([[0, 'no'], [1, 'no']]));
  });

  it("proposes the typed times in the host's zone, in order", () => {
    const checked: PollCheck = checkPollDraft(draft, who, engine);
    expect(checked).toEqual({ ok: true, poll: { id: 'p2', type_id: 'plan', host: 'ana', title: 'Planning', zone: NY, state: 'open', proposals: [half('2024-07-16T18:30:00Z'), half('2024-07-17T13:00:00Z')] } });
  });

  it('refuses overlapping times, a missing time, no type and no title', () => {
    const overlap: PollCheck = checkPollDraft({ ...draft, proposals: [{ date: '2024-07-16', time: '09:00' }, { date: '2024-07-16', time: '09:15' }] }, who, engine);
    expect(overlap.ok ? [] : [...overlap.errors.keys()]).toEqual(['proposals']);
    const rest: PollCheck = checkPollDraft({ title: '', typeId: null, durationMin: null, proposals: [{ date: '2024-07-16', time: '' }] }, who, engine);
    expect(rest.ok ? [] : [...rest.errors.keys()].sort()).toEqual(['proposal-0', 'title', 'type']);
  });
});
