/**
 * The server's answer to each of the reader's own peer-group sends, by the message it sent.
 *
 * A send's `GroupMessage` request id is what the agent's answer names (the agent pairs each
 * delivery report or refusal with the send it answers); the conversation knows the message by
 * the id the send minted. `expect` joins the two when the request goes out, and `answer`
 * records the outcome under the message. Bounded: an answer that never comes, or one for a
 * control body nobody shows, ages out with the oldest entries.
 */
import { notifyEach } from '@/lib/notify-listeners';
import type { GroupSendOutcome } from './group-send-outcome';

const MAX_HELD: number = 500;

interface Sent {
  readonly groupId: string;
  readonly messageId: string;
}

const sends: Map<string, Sent> = new Map<string, Sent>();
const outcomes: Map<string, GroupSendOutcome> = new Map<string, GroupSendOutcome>();
const listeners: Set<(change: Sent) => void> = new Set<(change: Sent) => void>();

function bounded<K, V>(map: Map<K, V>): void {
  while (map.size > MAX_HELD) {
    const oldest: K | undefined = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/** The send `requestId` carries `messageId` into `groupId`. */
export function expectSendOutcome(requestId: string, groupId: string, messageId: string): void {
  sends.set(requestId, { groupId, messageId });
  bounded(sends);
}

/** The server's answer to `requestId`; ignored when it names no send this tab made. */
export function recordSendOutcome(requestId: string, outcome: GroupSendOutcome): void {
  const sent: Sent | undefined = sends.get(requestId);
  if (sent === undefined) return;
  sends.delete(requestId);
  outcomes.set(sent.messageId, outcome);
  bounded(outcomes);
  notifyEach(listeners, 'group send outcomes', sent);
}

export function sendOutcomeOf(messageId: string): GroupSendOutcome | undefined {
  return outcomes.get(messageId);
}

/** Fires with the group and message whose outcome arrived. */
export function subscribeSendOutcomes(listener: (change: Sent) => void): () => void {
  listeners.add(listener);
  return (): void => { listeners.delete(listener); };
}

/** Test seam: the maps outlive a test. */
export function forgetSendOutcomes(): void {
  sends.clear();
  outcomes.clear();
}
