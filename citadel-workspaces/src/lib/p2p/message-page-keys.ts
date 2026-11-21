import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { PAGINATED_PREFIX } from './p2p-types';

/**
 * Where one account's conversation with one peer is stored: the owner is in the key, since
 * LocalDB bucket `0n` is shared by every account on the device. A record under the peer alone
 * was written before that and is never read.
 */
export function conversationPrefix(peerCid: bigint): string {
  return `${ownConversationPrefix()}${peerCid.toString()}`;
}

/** The prefix of every one of the signed-in account's conversation keys. */
export function ownConversationPrefix(): string {
  const own: bigint | null = instanceManager.cid;
  if (!own) throw new Error('No signed-in account: a conversation is stored under its owner');
  return `${PAGINATED_PREFIX}${own.toString()}_with_`;
}
