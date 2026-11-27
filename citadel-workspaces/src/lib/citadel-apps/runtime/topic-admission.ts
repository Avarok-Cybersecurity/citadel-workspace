/**
 * When a joiner is in a topic's group. The agent's answer to `GroupRequestJoin` is not that: it
 * says the owner was ASKED (agent `request_join.rs`, `RequestJoinPending`), and the owner's host
 * answers later (topic-port.ts). The member hears the group only once this session holds the
 * group's channel:
 *
 *   - already, when the agent lists the group among this session's joined groups (its live
 *     channels, agent `list_joined.rs`): another tab of the session joined it first;
 *   - or once the agent sends `GroupChannelCreateSuccess` for this session and group (no request
 *     id): the SDK opens it when the owner's Welcome arrives (citadel_proto `group_broadcast.rs`).
 *
 * Out: the join's own failure, `GroupRequestJoinDeclineResponse` for this session and group, or
 * no channel within `timeoutMs`. Gone: the join's failure says the group no longer exists (the
 * server's `GroupNonExists`: its last member left, or its owner ended it), so no owner will ever
 * admit anyone to it and the topic needs a new group (topic-port.ts). Pure over the injected
 * agent and its timers.
 */
import { groupIdToKey, groupKeyToId, parseGroupKey } from '@/lib/group-conversations/group-key';
import { agentAsk, variantOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';

/**
 * The agent's words for a join to a group the server does not have (agent `request_join.rs`,
 * `JoinOutcome::GroupGone`); the failure carries no other sign of it. Held to the agent's source by
 * __tests__/a-gone-group-is-the-agents-wording.test.ts.
 */
export const GROUP_GONE: string = 'That group no longer exists';

/** What asking to join came to: the owner was asked, the ask failed, or the group is gone. */
export type Asked = 'asked' | 'failed' | 'gone';

/**
 * Why a join left this session out: the owner's host declined it (`refused`), or no admission came
 * in time, whatever the reason on the way (`timeout`: the owner's app closed, an agent that did not answer).
 */
export type JoinOut = 'refused' | 'timeout';

/** Where a join left this session: in the group, out of it and why, or facing a group that no longer exists. */
export type Joined = 'in' | JoinOut | 'gone';

/** The agent's failure to a join, read: gone only by the agent's own words for it. */
export function askRefusal(failure: Json): Exclude<Asked, 'asked'> {
  return failure.message === GROUP_GONE ? 'gone' : 'failed';
}

export interface Admission {
  readonly agent: AgentLink;
  readonly cid: bigint;
  readonly groupId: string;
  readonly timeoutMs: number;
}

/** The agent's word on this session's place in `groupId`: true in, false out, undefined not about it. */
export function admissionOf(message: unknown, cid: bigint, groupId: string): boolean | undefined {
  const about = (body: Json | undefined): boolean => body !== undefined && body.cid === cid && groupKeyToId(parseGroupKey(body.group_key)) === groupId;
  if (about(variantOf(message, 'GroupChannelCreateSuccess'))) return true;
  return about(variantOf(message, 'GroupRequestJoinDeclineResponse')) ? false : undefined;
}

/** Asks the agent to join `a.groupId` for this session: the owner asked, the ask failed, or the group is gone. */
export async function askToJoin(a: Admission): Promise<Asked> {
  const r: AgentOutcome<Asked> = await agentAsk<Asked>(a.agent, (request_id: string): Json => ({ GroupRequestJoin: { cid: a.cid, group_key: groupIdToKey(a.groupId), request_id } }),
    (m: unknown, id: string): Asked | undefined => {
      if (variantOf(m, 'GroupRequestJoinSuccess')?.request_id === id) return 'asked';
      const failed: Json | undefined = variantOf(m, 'GroupRequestJoinFailure');
      return failed?.request_id === id ? askRefusal(failed) : undefined;
    }, a.timeoutMs);
  return r.ok ? r.value : 'failed';
}

/**
 * In when this session is in `groupId`: listed as joined (`joined`, the session's group ids, null
 * when the agent did not say), or admitted after `ask`. Listening starts before the ask goes out:
 * the channel can open as soon as the owner answers.
 */
export async function joinAdmitted(a: Admission, joined: () => Promise<readonly string[] | null>, ask: (a: Admission) => Promise<Asked>): Promise<Joined> {
  if ((await joined())?.includes(a.groupId) === true) return 'in';
  return new Promise<Joined>((resolve: (admitted: Joined) => void): void => {
    let done: boolean = false;
    const finish = (admitted: Joined): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(admitted);
    };
    const stop: () => void = a.agent.listen((m: unknown): void => {
      const word: boolean | undefined = admissionOf(m, a.cid, a.groupId);
      if (word !== undefined) finish(word ? 'in' : 'refused');
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => finish('timeout'), a.timeoutMs);
    ask(a).then((asked: Asked): void => { if (asked !== 'asked') finish(asked === 'gone' ? 'gone' : 'timeout'); }, (): void => finish('timeout'));
  });
}
