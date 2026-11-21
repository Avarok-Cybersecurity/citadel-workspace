/**
 * What a window knows about Message Retention: the agent removes a chat's
 * stored messages older than its period (retention-runner.ts), and says so with
 * a cutoff that the open views apply to what they hold.
 *
 * The store is the local agent's on this device, so this removes this device's
 * copy only: the peer keeps theirs. No delete is sent to them.
 */
import type { P2PMessage } from './p2p-types';

/** Emitted with the cutoff after a chat's messages older than it were removed. */
export const MESSAGES_EXPIRED_EVENT: 'p2p:messages-expired' = 'p2p:messages-expired';
export interface MessagesExpired { peerCid: bigint; cutoff: number }

/** The messages a cutoff keeps. Shared by the views over the store. */
export function retained<T extends Pick<P2PMessage, 'timestamp'>>(messages: readonly T[], cutoff: number): T[] {
  return messages.filter((m: T): boolean => m.timestamp >= cutoff);
}
