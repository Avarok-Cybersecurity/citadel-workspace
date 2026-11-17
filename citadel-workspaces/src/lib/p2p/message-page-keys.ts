import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { PAGINATED_PREFIX } from './p2p-types';

/**
 * Where one account's conversation with one peer is stored.
 *
 * Pages used to be keyed by PEER ALONE, in LocalDB bucket `0n`, which every
 * account on the device shares — on a product that explicitly expects several
 * accounts in one browser. Two accounts chatting with the same peer therefore
 * appended into the same pages, and after a reload each one's private messages
 * rendered in the other's transcript.
 *
 * An `ownerCid` stamp was added to the metadata, but it only guarded DELETION:
 * the second account's "Clear Chat History" hit a refusal that was written to a
 * debug log, so the screen emptied, the user was told it could not be undone,
 * and the history came back on the next reload.
 *
 * Putting the owner in the key removes the sharing itself rather than policing
 * it. The legacy prefix is still readable so existing history is not orphaned —
 * see `legacyConversationPrefix`.
 */
export function conversationPrefix(peerCid: bigint): string {
  const own: bigint | null = instanceManager.cid;
  // No session yet: fall back to the legacy shape rather than inventing an
  // owner. A record filed under a guessed account is worse than an unscoped one.
  if (!own) return legacyConversationPrefix(peerCid);
  return `${PAGINATED_PREFIX}${own.toString()}_with_${peerCid.toString()}`;
}

/** The peer-only prefix written before conversations were scoped by account. */
export function legacyConversationPrefix(peerCid: bigint): string {
  return `${PAGINATED_PREFIX}${peerCid.toString()}`;
}

/** True when the two differ, i.e. a legacy read is worth attempting. */
export function hasLegacyFallback(peerCid: bigint): boolean {
  return conversationPrefix(peerCid) !== legacyConversationPrefix(peerCid);
}
