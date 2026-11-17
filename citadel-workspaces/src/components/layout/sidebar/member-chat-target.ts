/**
 * Where clicking a member row goes: the conversation with them, contact or not.
 *
 * Owner (2026-10-15): clicking someone you are not registered with opens the chat anyway, which
 * then offers the connect request. A conversation is addressed by CID and a member by username,
 * so the CID comes from the contact, else from the agent's listing of workspace peers. Someone
 * neither knows cannot be addressed yet; your own row opens nothing.
 */
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

export type MemberChatTarget = { kind: 'conversation'; cid: bigint } | { kind: 'unreachable' } | null;

export function memberChatTarget(
  username: string,
  currentUsername: string | undefined,
  contacts: readonly RegisteredPeer[],
  listedCid: (username: string) => bigint | undefined,
): MemberChatTarget {
  if (username === currentUsername) return null;
  const contact: RegisteredPeer | undefined = contacts.find((p: RegisteredPeer): boolean => p.username === username);
  const cid: bigint | undefined = contact ? BigInt(contact.cid) : listedCid(username);
  return cid === undefined ? { kind: 'unreachable' } : { kind: 'conversation', cid };
}

/**
 * `memberChatTarget`, asking the listing for a fresh round once when it cannot address them.
 *
 * The listing is polled every 30s, so a colleague the agent already lists could still be missing
 * from it, and the click said they were unreachable until the next round.
 */
export async function resolveMemberChat(
  username: string,
  currentUsername: string | undefined,
  contacts: readonly RegisteredPeer[],
  listedCid: (username: string) => bigint | undefined,
  refreshListing: () => Promise<void>,
): Promise<MemberChatTarget> {
  const target: MemberChatTarget = memberChatTarget(username, currentUsername, contacts, listedCid);
  if (target?.kind !== 'unreachable') return target;
  await refreshListing();
  return memberChatTarget(username, currentUsername, contacts, listedCid);
}
