/**
 * The agent answers a join with "the owner was asked" (agent `request_join.rs`); the topic opens
 * for a joiner only once the agent says it is in the group (topic-admission.ts): a new channel,
 * or a group the session's agent already lists as joined. A decline or silence for `timeoutMs` is `Unavailable("topic")`, the app's typed failure. An owner whose open is still in
 * flight answers a join request for its group instead of dropping it.
 *
 * TEST FAKE: the agent is an in-memory AgentLink (the port's one I/O boundary) that answers each
 * request with its Success (the joined list: `joined`) and nothing else; the admission is pushed
 * by each case. The kernel's
 * claim is an injected function the owner case holds back. The port and its rules are production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortAnswer, PortReply } from '../../host/ports';
import type { PeerAuthorization } from '../../member-consent-types';
import type { TopicOpened } from '../../sdk/generated/TopicOpened';
import type { RequestType, ResponseType } from 'citadel-workspace-client-ts';
import type { AgentLink } from '../agent-link';
import { InstallPlaneRegistry } from '../install-plane-registry';
import { PeerAuthority } from '../peer-authority';
import { topicPort, type OwnedTopicPort } from '../topic-port';

const ME: bigint = 100n;
const THEIRS: Readonly<{ cid: bigint; mgid: bigint }> = { cid: 5n, mgid: 9n };
const MINE: Readonly<{ cid: bigint; mgid: bigint }> = { cid: ME, mgid: 7n };
/** The port's step bound in these cases (production: STANDARD_HOST_POLICY.portTimeoutMs). */
const TIMEOUT_MS: number = 1000;
const SUCCESS: Readonly<Partial<Record<RequestType, ResponseType>>> = {
  GroupListJoined: 'GroupListJoinedSuccess', GroupCreateAppTopic: 'GroupCreateSuccess', GroupRequestJoin: 'GroupRequestJoinSuccess', GroupRespondRequest: 'GroupRespondRequestSuccess', GroupLeave: 'GroupLeaveSuccess',
};

interface Rig {
  readonly port: OwnedTopicPort;
  readonly sent: string[];
  readonly push: (m: Record<string, unknown>) => Promise<void>;
  /** Lets the kernel answer the owner's claim (held back when `holdClaim`). */
  readonly answerClaim: () => void;
}

// Test defaults: the kernel holds `claimed` and answers at once unless `holdClaim`; the session is in no group yet; every peer is admitted.
function rig(claimed: string | null, holdClaim: boolean = false, joined: readonly unknown[] = []): Rig {
  const handlers: Set<(m: unknown) => void> = new Set();
  const sent: string[] = [];
  let n: number = 0;
  const agent: AgentLink = {
    newRequestId: () => `req-${++n}`,
    listen: (h) => { handlers.add(h); return () => handlers.delete(h); },
    send: async (request: Record<string, unknown>) => {
      const [variant, body] = Object.entries(request)[0] as [RequestType, Record<string, unknown>];
      sent.push(variant);
      const group_key: unknown = variant === 'GroupCreateAppTopic' ? MINE : body.group_key;
      queueMicrotask(() => handlers.forEach((h) => h({ [SUCCESS[variant] as string]: { cid: ME, request_id: body.request_id, group_key, groups: joined } })));
    },
  };
  let release: () => void = (): void => undefined;
  const claimHeld: Promise<void> = holdClaim ? new Promise<void>((r: () => void) => { release = r; }) : Promise.resolve();
  const admit = async (peerCid: bigint): Promise<PeerAuthorization> => ({ ok: true, peer: { username: 'bob', cid: peerCid, app_id: 'a', install_id: 'i' }, untilMs: 60_000n });
  const port: OwnedTopicPort = topicPort({
    seat: new InstallPlaneRegistry().attach('inst-1', 'net.avarok.compute-pool'),
    cid: ME, agent, topics: ['pool'], limits: { max_msg_bytes: 64, max_msgs_per_s: 2 }, timeoutMs: TIMEOUT_MS,
    authority: new PeerAuthority(admit, () => 0, 30),
    topicGroup: async (_t: string, claim: string | null) => { if (claim === null) return claimed; await claimHeld; return claim; },
    record: { group: () => undefined, request: () => undefined }, refused: () => undefined, notAMember: () => undefined,
  });
  const push = async (m: Record<string, unknown>): Promise<void> => { handlers.forEach((h) => h(m)); await vi.advanceTimersByTimeAsync(0); };
  return { port, sent, push, answerClaim: (): void => release() };
}

/** The open's answer if it has one yet. */
interface Watched { readonly now: () => PortAnswer<TopicOpened> | 'pending' }

function watch(answer: PortReply<TopicOpened>): Watched {
  let got: PortAnswer<TopicOpened> | 'pending' = 'pending';
  void Promise.resolve(answer).then((a: PortAnswer<TopicOpened>) => { got = a; });
  return { now: () => got };
}

const OPENED: PortAnswer<TopicOpened> = { ok: { name: 'pool', members: [] } };
const UNAVAILABLE: PortAnswer<TopicOpened> = { refused: { unavailable: 'topic' } };
const channel = (cid: bigint, group_key: unknown): Record<string, unknown> => ({ GroupChannelCreateSuccess: { cid, group_key, request_id: null } });

describe('a joiner is in the topic only once admitted', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stays pending after "the owner was asked"; another session’s or group’s channel does not open it; its own does', async () => {
    vi.useFakeTimers();
    const r: Rig = rig('5:9');
    const open: Watched = watch(r.port.TopicOpen({ name: 'pool' }));
    await vi.advanceTimersByTimeAsync(0);
    expect([r.sent, open.now()]).toEqual([['GroupListJoined', 'GroupRequestJoin'], 'pending']);
    await r.push(channel(999n, THEIRS));
    await r.push(channel(ME, { cid: 5n, mgid: 1n }));
    expect(open.now()).toBe('pending');
    await r.push(channel(ME, THEIRS));
    expect(open.now()).toEqual(OPENED);
  });

  it('a session already in the group (another tab joined it) is in without asking again', async () => {
    vi.useFakeTimers();
    const r: Rig = rig('5:9', false, [THEIRS]);
    const open: Watched = watch(r.port.TopicOpen({ name: 'pool' }));
    await vi.advanceTimersByTimeAsync(0);
    expect([r.sent, open.now()]).toEqual([['GroupListJoined'], OPENED]);
  });

  it('a decline is Unavailable, and the port says the owner refused', async () => {
    vi.useFakeTimers();
    const r: Rig = rig('5:9');
    const open: Watched = watch(r.port.TopicOpen({ name: 'pool' }));
    await vi.advanceTimersByTimeAsync(0);
    await r.push({ GroupRequestJoinDeclineResponse: { cid: ME, group_key: THEIRS, request_id: null } });
    expect(open.now()).toEqual(UNAVAILABLE);
    expect(r.port.outReason('pool')).toBe('refused');
  });

  it('an admission that never comes is Unavailable once the bound passes, said as a timeout (paused clock)', async () => {
    vi.useFakeTimers();
    const r: Rig = rig('5:9');
    const open: Watched = watch(r.port.TopicOpen({ name: 'pool' }));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(open.now()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(open.now()).toEqual(UNAVAILABLE);
    expect(r.port.outReason('pool')).toBe('timeout');
  });

  it('an owner whose open is in flight answers a join request for its group instead of dropping it', async () => {
    vi.useFakeTimers();
    const r: Rig = rig(null, true);
    const open: Watched = watch(r.port.TopicOpen({ name: 'pool' }));
    await vi.advanceTimersByTimeAsync(0);
    expect([r.sent, open.now()]).toEqual([['GroupCreateAppTopic'], 'pending']);
    await r.push({ GroupJoinRequestNotification: { cid: ME, peer_cid: 8n, group_key: MINE, request_id: null } });
    expect(r.sent).toEqual(['GroupCreateAppTopic', 'GroupRespondRequest']);
    r.answerClaim();
    await vi.advanceTimersByTimeAsync(0);
    expect(open.now()).toEqual(OPENED);
  });
});
