import type { Peer } from '@/components/p2p/usePeerDiscovery';

/**
 * The peer a directory member corresponds to, or why they cannot be reached.
 *
 * A member is identified by USERNAME; registration needs a CID. Only the peer
 * list carries both, so a member who has never appeared there cannot be reached
 * — and saying so is better than sending nothing and reporting success.
 *
 * `null` for the list is a third answer and not the second one. It means
 * discovery never succeeded, and telling somebody their colleague "needs to be
 * online at least once" when the truth is that we could not ask sends them to
 * wait for something that has probably already happened.
 *
 * Throws rather than returning a result type because every caller turns the
 * failure into the same toast, and the message IS the product behaviour here.
 */
export function reachablePeer(
  discovered: Peer[] | null,
  member: { id: string; displayName: string },
): Peer {
  if (discovered === null) {
    throw new Error(
      'The list of people in this workspace could not be loaded, so requests cannot be sent yet. Try again in a moment.',
    );
  }
  const peer: Peer | undefined = discovered.find((candidate): boolean => candidate.username === member.id);
  if (!peer) throw new Error(unreachableMemberCopy(member.displayName));
  return peer;
}

/** Why a member the agent has never listed cannot be messaged or asked to connect yet. */
export function unreachableMemberCopy(displayName: string): string {
  return `${displayName} is not reachable yet. They need to be online at least once before a request can be sent.`;
}
