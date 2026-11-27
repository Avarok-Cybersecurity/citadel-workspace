/**
 * App topics over Citadel GroupBroadcast (p2p-demo-design §7): one group per (install, topic),
 * never a chat group. The group's key is the kernel's to keep (`TopicGroup`, first writer wins):
 * the first member to open a topic creates the group and claims it; later members ask to join,
 * and the owner's host admits only whom `AuthorizePeer(Topic)` admits. A group ends when its last
 * member leaves (a lone member closing the app), and the kernel's record of it does not: an open
 * told the recorded group is gone creates another and records it in the ended one's place, so
 * whoever opens the topic next hosts it rather than waiting on a group nobody can admit them to.
 * Every key and every create
 * request is recorded with the chat pipeline (group-conversations/app-topic-groups.ts) before the
 * agent can answer, so a topic never appears as a conversation. Message rules are topic-model.ts.
 *
 * A sender's identity is the session's (`peer_cid`) stamped by the kernel's answer for it, never
 * what the body says. Two instances of the install on this page hold one membership: the group is
 * joined by the first and left by the last, and one of them answers join requests
 * (install-plane-registry.ts). Pure over the injected agent and kernel.
 *
 * `TopicOpen` answers ok only once this member hears the group: a joiner waits for the agent to
 * say it was admitted (topic-admission.ts), never for the agent's "the owner was asked". Every
 * open ends, in the group or in `Unavailable("topic")`, within `timeoutMs` of each agent or kernel
 * step (the host's `portTimeoutMs`, 10 s in STANDARD_HOST_POLICY), and the dispatcher bounds the
 * whole call by the same `portTimeoutMs` (host/dispatch.ts `bounded`, `Refused { limit: "timeout" }`).
 */
import type { PortAnswer, TopicArrival, TopicPort } from '../host/ports';
import type { PeerAuthorization } from '../member-consent-types';
import type { TopicOpened } from '../sdk/generated/TopicOpened';
import { groupIdToKey, groupKeyToId, parseGroupKey } from '@/lib/group-conversations/group-key';
import { agentAsk, bytesOf, variantOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';
import type { PlaneSeat } from './install-plane-registry';
import type { PeerAuthority } from './peer-authority';
import { askToJoin, joinAdmitted, type Joined, type JoinOut } from './topic-admission';
import { LIMIT_TOPIC_BYTES, LIMIT_TOPIC_RATE } from '../sdk/generated/AbiConstants';
import { mayOpen, readTopicMessage, topicEnvelope, type TopicLimits } from './topic-model';

export interface TopicDeps {
  readonly cid: bigint;
  readonly agent: AgentLink;
  /** The install's granted topic names (`details.topics`). */
  readonly topics: readonly string[];
  readonly limits: TopicLimits;
  /** AppsRequest::TopicGroup: the group id the kernel holds for this topic (null: none), after claiming `claim` if none was, or if `replaces` was; `refused` when it would not say. */
  readonly topicGroup: (topic: string, claim: string | null, replaces: string | null) => Promise<string | null | 'refused'>;
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
  /**
   * The server refused one of this session's messages to an open topic because the session is not
   * in its group (it was removed, or the group passed on). The refusal answers no publish and the
   * topic ABI has no event for it, so it is reported here rather than dropped.
   */
  readonly notAMember: (topic: string) => void;
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
export type OwnedTopicPort = TopicPort & {
  readonly closeAll: () => Promise<void>;
  /** Why the topic's last open here left this member out; null when it did not (topic-rejoin.ts reads it). */
  readonly outReason: (name: string) => JoinOut | null;
};

export function topicPort(d: TopicDeps): OwnedTopicPort {
  const open: Map<string, Open> = new Map<string, Open>();
  /** Groups an open in flight has learnt (the topic's name by group id): a join request or a message for one is not dropped. */
  const opening: Map<string, string> = new Map<string, string>();
  const outs: Map<string, JoinOut> = new Map<string, JoinOut>();
  const out = (name: string, why: JoinOut): null => { outs.set(name, why); return null; };
  const listeners: Set<(a: TopicArrival) => void> = new Set<(a: TopicArrival) => void>();
  const emit = (a: TopicArrival): void => { for (const l of [...listeners]) l(a); };
  const topicOf = (groupId: string): string | undefined => [...open.entries()].find(([, o]: [string, Open]) => o.groupId === groupId)?.[0] ?? opening.get(groupId);

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
  /** In the group: the owner admitted this session (topic-admission.ts), not merely was asked. */
  const joined = async (): Promise<readonly string[] | null> => {
    const r: AgentOutcome<Json | null> = await ask((request_id: string): Json => ({ GroupListJoined: { cid: d.cid, request_id } }), 'GroupListJoinedSuccess', 'GroupListJoinedFailure');
    const groups: unknown = r.ok ? r.value?.groups : undefined;
    return Array.isArray(groups) ? groups.map((k: unknown): string => groupKeyToId(parseGroupKey(k))) : null;
  };
  const join = (groupId: string): Promise<Joined> => joinAdmitted({ agent: d.agent, cid: d.cid, groupId, timeoutMs: d.timeoutMs }, joined, askToJoin);
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

  /** In `groupId` for `name`: a join request or a message for it is not dropped meanwhile. */
  const enter = (groupId: string, name: string): Promise<Joined> => {
    d.record.group(groupId);
    opening.set(groupId, name);
    return join(groupId);
  };
  /** A group created here and claimed, in place of `ended` (the recorded group, gone) if given. */
  const founded = async (name: string, ended: string | null): Promise<string | null> => {
    const mine: string | null = await create();
    if (mine === null) return out(name, 'timeout');
    d.record.group(mine);
    // Joiners can find the group as soon as the kernel holds the claim, before this open is done.
    opening.set(mine, name);
    const kept: string | null | 'refused' = await d.topicGroup(name, mine, ended);
    if (kept === mine) return mine;
    // Another member claimed first (or the claim was refused): theirs is the topic's, ours goes.
    opening.delete(mine);
    void leave(mine, null);
    if (kept === null || kept === 'refused' || kept === ended) return out(name, kept === 'refused' ? 'refused' : 'timeout');
    const joinedKept: Joined = await enter(kept, name);
    return joinedKept === 'in' ? kept : out(name, joinedKept === 'refused' ? 'refused' : 'timeout');
  };
  /** The topic's group: the recorded one joined, or one created here when none is recorded or it is gone. */
  const groupFor = async (name: string): Promise<string | null> => {
    await settled();
    const held: string | null | 'refused' = await d.topicGroup(name, null, null);
    if (held === 'refused') return out(name, 'refused');
    if (held === null) return founded(name, null);
    const joinedHeld: Joined = await enter(held, name);
    if (joinedHeld === 'in') return held;
    if (joinedHeld !== 'gone') return out(name, joinedHeld);
    opening.delete(held);
    return founded(name, held);
  };

  const sender = async (peerCid: bigint, name: string): Promise<PeerAuthorization | 'limited'> => d.authority.authorize(peerCid, { Topic: { topic: name } });

  const unlisten: (() => void)[] = [];
  unlisten.push(d.agent.listen((m: unknown): void => {
    const refusal: Json | undefined = variantOf(m, 'GroupMessageRefusedNotification');
    if (refusal === undefined || refusal.cid !== d.cid) return;
    const topic: string | undefined = topicOf(groupKeyToId(parseGroupKey(refusal.group_key)));
    // A send from a session no longer in the topic's group broke no cap: it is not a limit event.
    if (topic === undefined) return;
    if (refusal.refusal === 'NotAMember') { d.notAMember(topic); return; }
    d.refused(topic, variantOf(refusal.refusal, 'RateLimited') === undefined ? LIMIT_TOPIC_BYTES : LIMIT_TOPIC_RATE);
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
        outs.delete(name);
        const groupId: string | null = await d.seat.holdTopic(name, () => groupFor(name));
        for (const [id, topic] of [...opening]) if (topic === name) opening.delete(id);
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
      outs.clear();
      listeners.clear();
      for (const stop of unlisten.splice(0)) stop();
      return settled();
    },
    onEvent: (listener: (a: TopicArrival) => void): (() => void) => {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
    outReason: (name: string): JoinOut | null => outs.get(name) ?? null,
  };
}
