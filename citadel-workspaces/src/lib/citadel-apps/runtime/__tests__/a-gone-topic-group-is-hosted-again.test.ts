/**
 * A topic's group ends when its last member leaves, and the kernel's record of it does not. The
 * member who opens the topic next is told by the agent that the recorded group no longer exists;
 * it hosts the topic itself (creates a group and records it in the ended one's place), so a lone
 * member reopening an app is never left waiting for anyone, least of all themselves. A failure
 * that does not say the group is gone moves nothing, and of two members replacing the same ended
 * group, the second joins the first's.
 *
 * TEST FAKE: the agent is an in-memory AgentLink (the port's one I/O boundary) that keeps the
 * server's groups as the SDK does (a group lives until its last member leaves; a join to a group
 * it does not have fails with the agent's own words for it), and the kernel's record is an
 * injected function with the kernel's swap rule (kernel_topic_replace_tests.rs holds the real one).
 * The port, its rules and the admission are production.
 */
import { describe, expect, it } from 'vitest';
import type { PortAnswer } from '../../host/ports';
import type { PeerAuthorization } from '../../member-consent-types';
import type { TopicOpened } from '../../sdk/generated/TopicOpened';
import { groupIdToKey, groupKeyToId, parseGroupKey } from '@/lib/group-conversations/group-key';
import type { AgentLink } from '../agent-link';
import { InstallPlaneRegistry } from '../install-plane-registry';
import { PeerAuthority } from '../peer-authority';
import { GROUP_GONE } from '../topic-admission';
import { topicPort, type OwnedTopicPort } from '../topic-port';

const ME: bigint = 100n;
const OPENED: PortAnswer<TopicOpened> = { ok: { name: 'cal', members: [] } };
const UNAVAILABLE: PortAnswer<TopicOpened> = { refused: { unavailable: 'topic' } };

interface Server {
  /** The server's groups by id, with their members. */
  readonly groups: Map<string, Set<bigint>>;
  /** The kernel's record for the topic. */
  record: string | null;
  readonly claims: [string, string | null][];
  readonly sent: string[];
  /** A group another member records first when this one replaces `ended` (a race), else null. */
  racer: string | null;
  /** The words the agent fails a join with; the agent's gone wording unless a case says otherwise. */
  joinFailure: string;
  /** The last group id the server handed out (ids are never reused). */
  mgid: bigint;
}

// Test defaults: nothing recorded, no racer, and a join to a missing group fails as the agent says it.
function server(): Server {
  return { groups: new Map(), record: null, claims: [], sent: [], racer: null, joinFailure: GROUP_GONE, mgid: 0n };
}

function portOver(s: Server): OwnedTopicPort {
  const handlers: Set<(m: unknown) => void> = new Set();
  let n: number = 0;
  const say = (m: Record<string, unknown>): void => queueMicrotask(() => handlers.forEach((h) => h(m)));
  const agent: AgentLink = {
    newRequestId: () => `req-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
      s.sent.push(variant);
      const request_id: unknown = body.request_id;
      const id: string | null = body.group_key === undefined ? null : groupKeyToId(parseGroupKey(body.group_key));
      if (variant === 'GroupCreateAppTopic') {
        s.mgid += 1n;
        s.groups.set(`${ME}:${s.mgid}`, new Set([ME]));
        say({ GroupCreateSuccess: { cid: ME, request_id, group_key: { cid: ME, mgid: s.mgid } } });
      } else if (variant === 'GroupListJoined') {
        const mine: string[] = [...s.groups].filter(([, m]) => m.has(ME)).map(([g]) => g);
        say({ GroupListJoinedSuccess: { cid: ME, request_id, groups: mine.map(groupIdToKey) } });
      } else if (variant === 'GroupRequestJoin' && id !== null) {
        say(s.groups.has(id) ? { GroupRequestJoinSuccess: { cid: ME, request_id, group_key: body.group_key } } : { GroupRequestJoinFailure: { cid: ME, request_id, message: s.joinFailure } });
      } else if (variant === 'GroupLeave' && id !== null) {
        const members: Set<bigint> | undefined = s.groups.get(id);
        members?.delete(ME);
        if (members?.size === 0) s.groups.delete(id);
        say({ GroupLeaveSuccess: { cid: ME, request_id, group_key: body.group_key } });
      }
    },
  };
  const admit = async (peerCid: bigint): Promise<PeerAuthorization> => ({ ok: true, peer: { username: 'amy', cid: peerCid, app_id: 'a', install_id: 'i' }, untilMs: 60_000n });
  return topicPort({
    seat: new InstallPlaneRegistry().attach('cal', 'net.avarok.calendar'),
    cid: ME, agent, topics: ['cal'], limits: { max_msg_bytes: 64, max_msgs_per_s: 2 }, timeoutMs: 1000,
    authority: new PeerAuthority(admit, () => 0, 30),
    // The kernel's rule: a claim is recorded when nothing is, or in place of the ended group it names.
    topicGroup: async (_t: string, claim: string | null, replaces: string | null) => {
      s.claims.push([claim ?? '', replaces]);
      if (claim !== null && s.racer !== null && replaces !== null && s.record === replaces) s.record = s.racer;
      if (claim !== null && (s.record === null || s.record === replaces)) s.record = claim;
      return s.record;
    },
    record: { group: () => undefined, request: () => undefined }, refused: () => undefined, notAMember: () => undefined,
  });
}

/** The lone member's first visit: the topic is created, claimed, and left as the app closes. */
async function aFirstVisit(s: Server): Promise<string> {
  const first: OwnedTopicPort = portOver(s);
  expect(await first.TopicOpen({ name: 'cal' })).toEqual(OPENED);
  const hosted: string | null = s.record;
  expect(hosted).not.toBeNull();
  await first.closeAll();
  expect(s.groups.has(hosted as string), 'the last member left, so the group ended').toBe(false);
  return hosted as string;
}

describe('a topic whose group is gone', () => {
  it('is hosted again by the lone member who reopens it', async () => {
    const s: Server = server();
    const ended: string = await aFirstVisit(s);
    s.sent.length = 0;
    expect(await portOver(s).TopicOpen({ name: 'cal' })).toEqual(OPENED);
    expect(s.sent).toContain('GroupCreateAppTopic');
    expect(s.claims.at(-1)?.[1], 'the new group is recorded in the ended one\'s place').toBe(ended);
    expect(s.record).not.toBe(ended);
    expect(s.groups.get(s.record as string)?.has(ME)).toBe(true);
  });

  it('is not replaced when the join failed for any other reason', async () => {
    const s: Server = server();
    const ended: string = await aFirstVisit(s);
    s.joinFailure = 'No answer to the join request within 30s';
    s.sent.length = 0;
    expect(await portOver(s).TopicOpen({ name: 'cal' })).toEqual(UNAVAILABLE);
    expect(s.sent).not.toContain('GroupCreateAppTopic');
    expect(s.record).toBe(ended);
  });

  it('is joined, not replaced twice, when another member replaced it first', async () => {
    const s: Server = server();
    await aFirstVisit(s);
    s.racer = '5:1';
    s.groups.set('5:1', new Set([5n, ME]));
    s.sent.length = 0;
    expect(await portOver(s).TopicOpen({ name: 'cal' })).toEqual(OPENED);
    expect(s.record).toBe('5:1');
    expect(s.sent.filter((v) => v === 'GroupLeave'), 'the group made here for the lost race is left').toHaveLength(1);
  });
});
