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
 * no channel within `timeoutMs`. Pure over the injected agent and its timers.
 */
import { groupKeyToId, parseGroupKey } from '@/lib/group-conversations/group-key';
import { variantOf, type AgentLink, type Json } from './agent-link';

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

/**
 * True when this session is in `groupId`: listed as joined (`joined`, the session's group ids, null
 * when the agent did not say), or admitted after `ask` (true when the owner was asked). Listening
 * starts before the ask goes out: the channel can open as soon as the owner answers.
 */
export async function joinAdmitted(a: Admission, joined: () => Promise<readonly string[] | null>, ask: () => Promise<boolean>): Promise<boolean> {
  if ((await joined())?.includes(a.groupId) === true) return true;
  return new Promise<boolean>((resolve: (admitted: boolean) => void): void => {
    let done: boolean = false;
    const finish = (admitted: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(admitted);
    };
    const stop: () => void = a.agent.listen((m: unknown): void => {
      const word: boolean | undefined = admissionOf(m, a.cid, a.groupId);
      if (word !== undefined) finish(word);
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => finish(false), a.timeoutMs);
    ask().then((asked: boolean): void => { if (!asked) finish(false); }, (): void => finish(false));
  });
}
