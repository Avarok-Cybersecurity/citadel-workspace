/**
 * Who a member waiting on a topic is waiting for (topic-rejoin.ts `owner`). Pure over the kernel's
 * answer for the peer, through the install's PeerAuthority.
 */
import { groupIdToKey, isValidGroupId } from '@/lib/group-conversations/group-key';
import type { PeerAuthorization } from '../member-consent-types';
import type { PeerAuthority } from './peer-authority';
import type { TopicOwner } from './topic-rejoin';

/**
 * The topic's owner by name: the group's creator (its key's cid), as the kernel names that member to
 * this install. Never this session: a member is not told to wait for themselves.
 */
export async function ownerOf(groupId: string | null | 'refused', name: string, self: bigint, authority: PeerAuthority): Promise<TopicOwner | null> {
  if (groupId === null || groupId === 'refused' || !isValidGroupId(groupId)) return null;
  const creator: bigint = groupIdToKey(groupId).cid;
  if (creator === self) return null;
  const said: PeerAuthorization | 'limited' = await authority.authorize(creator, { Topic: { topic: name } });
  return said !== 'limited' && said.ok ? { username: said.peer.username, cid: creator } : null;
}
