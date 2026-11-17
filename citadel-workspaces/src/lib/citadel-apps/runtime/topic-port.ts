/**
 * App topics over Citadel GroupBroadcast (p2p-demo-design §7): one group per (install, topic),
 * never a chat group. The group's key is the kernel's to keep (`TopicGroup`, first writer wins):
 * the first member to open a topic creates the group and claims it; later members ask to join,
 * and the owner's host admits only whom `AuthorizePeer(Topic)` admits. Every key and every create
 * request is recorded with the chat pipeline (group-conversations/app-topic-groups.ts) before the
 * agent can answer, so a topic never appears as a conversation. Message rules are topic-model.ts.
 *
 * A sender's identity is the session's (`peer_cid`) stamped by the kernel's answer for it, never
 * what the body says. Two instances of the install on this page hold one membership: the group is
 * joined by the first and left by the last, and one of them answers join requests
 * (install-plane-registry.ts). Pure over the injected agent and kernel.
 */
import type { PortAnswer, TopicArrival, TopicPort } from '../host/ports';
import type { PeerAuthorization } from '../member-consent-types';
import type { TopicOpened } from '../sdk/generated/TopicOpened';
import { groupIdToKey, groupKeyToId, parseGroupKey } from '@/lib/group-conversations/group-key';
import { agentAsk, bytesOf, variantOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';
import type { PlaneSeat } from './install-plane-registry';
import type { PeerAuthority } from './peer-authority';
import { LIMIT_TOPIC_BYTES, LIMIT_TOPIC_RATE } from '../sdk/generated/AbiConstants';
import { mayOpen, readTopicMessage, topicEnvelope, type TopicLimits } from './topic-model';

export interface TopicDeps {
  readonly cid: bigint;
  readonly agent: AgentLink;
  /** The install's granted topic names (`details.topics`). */
  readonly topics: readonly string[];
  readonly limits: TopicLimits;
  /** AppsRequest::TopicGroup: the group id the kernel holds for this topic (null: none), after claiming `claim` if none was; `refused` when it would not say. */
  readonly topicGroup: (topic: string, claim: string | null) => Promise<string | null | 'refused'>;
  readonly authority: PeerAuthority;
  /** This instance's place among the install's instances on the page. */
  readonly seat: PlaneSeat;
  /** What the chat pipeline must skip (app-topic-groups.ts). */
  readonly record: { readonly group: (groupId: string) => void; readonly request: (requestId: string) => void };
  readonly timeoutMs: number;
  /**
   * The server refused one of this session's messages to an open topic (its caps are the
   * manifest's limits, which the sender already holds to, so this means they disagree). The
   * agent names no request (request_id is always null), so it answers no publish: it is reported.
   */
  readonly refused: (topic: string, limit: typeof LIMIT_TOPIC_BYTES | typeof LIMIT_TOPIC_RATE) => void;
}

interface Open {
  readonly groupId: string;
}

const UNAVAILABLE: PortAnswer<never> = { refused: { unavailable: 'topic' } };

/**
 * A topic port with what its instance's end needs: leave every topic still open, settling once the
 * agent has answered every leave. A leave is this session's, not this instance's: one still in
 * flight when the same session joins again (a restarted instance) would land after the join and
 * take the session out of the group it just joined.
 */
export type OwnedTopicPort = TopicPort & { readonly closeAll: () => Promise<void> };

export function topicPort(d: TopicDeps): OwnedTopicPort {
  const open: Map<string, Open> = new Map<string, Open>();
  const listeners: Set<(a: TopicArrival) => void> = new Set<(a: TopicArrival) => void>();
  const emit = (a: TopicArrival): void => { for (const l of [...listeners]) l(a); };
  const topicOf = (groupId: string): string | undefined => [...open.entries()].find(([, o]: [string, Open]) => o.groupId === groupId)?.[0];

  const ask = (build: (id: string) => Json, ok: string, failed: string): Promise<AgentOutcome<Json | null>> =>
    agentAsk<Json | null>(d.agent, build, (m: unknown, id: string): Json | null | undefined => {
      const yes: Json | undefined = variantOf(m, ok);
      if (yes?.request_id === id) return yes;
      return variantOf(m, failed)?.request_id === id ? null : undefined;
    }, d.timeoutMs);

  const create = async (): Promise<string | null> => {
    const r: AgentOutcome<Json | null> = await ask((request_id: string): Json => {
      d.record.request(request_id);
      // The agent's app-topic group: owner-accepted joins, ephemeral, capped server-side by the manifest's topic limits.
      return { GroupCreateAppTopic: { cid: d.cid, request_id, max_msg_bytes: d.limits.max_msg_bytes, max_msgs_per_s: d.limits.max_msgs_per_s } };
    }, 'GroupCreateSuccess', 'GroupCreateFailure');
    return r.ok && r.value !== null ? groupKeyToId(parseGroupKey(r.value.group_key)) : null;
  };
  const join = async (groupId: string): Promise<boolean> => {
    const r: AgentOutcome<Json | null> = await ask((request_id: string): Json =>
      ({ GroupRequestJoin: { cid: d.cid, group_key: groupIdToKey(groupId), request_id } }), 'GroupRequestJoinSuccess', 'GroupRequestJoinFailure');
    return r.ok && r.value !== null;
  };
  /** Leaves still unanswered: a join or create waits for them (see OwnedTopicPort). */
  const leaving: Set<Promise<unknown>> = new Set<Promise<unknown>>();
  const leave = (groupId: string, topic: string | null): Promise<unknown> => {
    const left: Promise<unknown> = ask((request_id: string): Json => ({ GroupLeave: { cid: d.cid, group_key: groupIdToKey(groupId), request_id } }), 'GroupLeaveSuccess', 'GroupLeaveFailure');
    leaving.add(left);
    if (topic !== null) d.seat.leaving(topic, left);
    const drop = (): void => { leaving.delete(left); };
    void left.then(drop, drop);
    return left;
  };
  const settled = async (): Promise<void> => { await Promise.all([...leaving]); };
  /** Lets go of the topic: the group is left only when no other instance here holds it. */
  const release = (name: string): void => {
    const last: string | null = d.seat.releaseTopic(name);
    if (last !== null) void leave(last, name);
  };

  /** The topic's group, created and claimed here when the kernel holds none. */
  const groupFor = async (name: string): Promise<string | null> => {
    await settled();
    const held: string | null | 'refused' = await d.topicGroup(name, null);
    if (held === 'refused') return null;
    if (held !== null) {
      d.record.group(held);
      return (await join(held)) ? held : null;
    }
    const mine: string | null = await create();
    if (mine === null) return null;
    d.record.group(mine);
    const kept: string | null | 'refused' = await d.topicGroup(name, mine);
    if (kept === mine) return mine;
    // Another member claimed first (or the claim was refused): theirs is the topic's, ours goes.
    void leave(mine, null);
    if (kept === null || kept === 'refused') return null;
    d.record.group(kept);
    return (await join(kept)) ? kept : null;
  };

  const sender = async (peerCid: bigint, name: string): Promise<PeerAuthorization | 'limited'> => d.authority.authorize(peerCid, { Topic: { topic: name } });

  const unlisten: (() => void)[] = [];
  unlisten.push(d.agent.listen((m: unknown): void => {
    const refusal: Json | undefined = variantOf(m, 'GroupMessageRefusedNotification');
    if (refusal === undefined || refusal.cid !== d.cid) return;
    const topic: string | undefined = topicOf(groupKeyToId(parseGroupKey(refusal.group_key)));
    if (topic !== undefined) d.refused(topic, variantOf(refusal.refusal, 'RateLimited') === undefined ? LIMIT_TOPIC_BYTES : LIMIT_TOPIC_RATE);
  }));

  unlisten.push(d.agent.listen((m: unknown): void => {
    const message: Json | undefined = variantOf(m, 'GroupMessageNotification');
    const joinAsk: Json | undefined = variantOf(m, 'GroupJoinRequestNotification');
    const n: Json | undefined = message ?? joinAsk;
    if (n === undefined || n.cid !== d.cid || typeof n.peer_cid !== 'bigint') return;
    const groupId: string = groupKeyToId(parseGroupKey(n.group_key));
    const name: string | undefined = topicOf(groupId);
    if (name === undefined) return;
    const peerCid: bigint = n.peer_cid;
    // One instance here answers a join; every instance hears the messages.
    if (joinAsk !== undefined && !d.seat.answersJoins(name)) return;
    void sender(peerCid, name).then((a: PeerAuthorization | 'limited'): void => {
      const admitted: boolean = a !== 'limited' && a.ok;
      if (joinAsk !== undefined) {
        void ask((request_id: string): Json => ({ GroupRespondRequest: { cid: d.cid, peer_cid: peerCid, group_key: groupIdToKey(groupId), response: admitted, request_id, invitation: false } }), 'GroupRespondRequestSuccess', 'GroupRespondRequestFailure');
        return;
      }
      const bytes: Uint8Array | null = bytesOf(n.message);
      const read: { readonly name: string; readonly body: Uint8Array } | null = bytes === null ? null : readTopicMessage(bytes, new Set([name]), d.limits);
      if (read === null) return;
      if (a === 'limited' || !a.ok) { emit({ name, event: { dropped: { from: peerCid.toString() } } }); return; }
      emit({ name, event: { message: { from: { username: a.peer.username, cid: a.peer.cid, app_id: a.peer.app_id, install_id: a.peer.install_id, via: 'group' }, body: read.body } } });
    });
  }));

  return {
    TopicOpen: async ({ name }: { name: string }): Promise<PortAnswer<TopicOpened>> => {
      if (!mayOpen(name, d.topics)) return { refused: { policy: 'unknown_topic' } };
      if (!open.has(name)) {
        const groupId: string | null = await d.seat.holdTopic(name, () => groupFor(name));
        if (groupId === null) return UNAVAILABLE;
        open.set(name, { groupId });
      }
      return { ok: { name, members: [] } };
    },
    TopicPublish: async ({ name, body }: { name: string; body: Uint8Array }): Promise<PortAnswer<null>> => {
      const o: Open | undefined = open.get(name);
      // Size and rate were decided by the worker as the app published (host/topic-sender.ts); the envelope is checked against the server's cap.
      if (o === undefined) return { refused: { policy: 'topic_not_open' } };
      const message: Uint8Array | null = topicEnvelope(name, body, d.limits);
      if (message === null) return { refused: { limit: LIMIT_TOPIC_BYTES } };
      const sent: AgentOutcome<Json | null> = await ask((request_id: string): Json =>
        ({ GroupMessage: { cid: d.cid, message: Array.from(message), group_key: groupIdToKey(o.groupId), request_id } }), 'GroupMessageSuccess', 'GroupMessageFailure');
      return sent.ok && sent.value !== null ? { ok: null } : UNAVAILABLE;
    },
    TopicClose: ({ name }: { name: string }): PortAnswer<null> => {
      const o: Open | undefined = open.get(name);
      if (o !== undefined) {
        open.delete(name);
        release(name);
      }
      return { ok: null };
    },
    closeAll: (): Promise<void> => {
      for (const name of [...open.keys()]) release(name);
      open.clear();
      listeners.clear();
      for (const stop of unlisten.splice(0)) stop();
      return settled();
    },
    onEvent: (listener: (a: TopicArrival) => void): (() => void) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
  };
}
