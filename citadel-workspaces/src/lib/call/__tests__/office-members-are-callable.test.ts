/**
 * The members of an office are callable by their CIDs, found through the peer directory.
 *
 * Measured live on a hosted workspace: the office call button stayed disabled with "No one
 * else is in this conversation yet" beside a member who was chatting in that same channel.
 * The roster's ids are usernames ("max.lab"), and the hook parsed them as CIDs, so every
 * member was dropped and no office call could ever start.
 */
import { describe, it, expect } from 'vitest';
import { callableMembers, type DirectoryPeer, type RosterMember } from '../callable-members';

describe('office call members', () => {
  const peers: DirectoryPeer[] = [{ cid: 11n, username: 'max.lab' }, { cid: 12n, username: 'nia.lab' }, { cid: 10n, username: 'lara.lab' }];

  it('maps member usernames to their CIDs and leaves out the caller', () => {
    const members: RosterMember[] = [{ id: 'lara.lab', username: 'lara.lab', displayName: 'Lara Lead' }, { id: 'max.lab', username: 'max.lab', displayName: 'Max Member' }];
    expect(callableMembers(members, peers, 10n, new Set([11n]))).toEqual({ callable: [{ cid: 11n, username: 'max.lab' }], notConnected: [] });
  });

  it('leaves out a member the directory does not know rather than guessing', () => {
    expect(callableMembers([{ id: 'ghost', username: 'ghost', displayName: 'Ghost' }], peers, 10n, new Set([11n]))).toEqual({ callable: [], notConnected: [] });
  });

  it('names a member you are not connected with instead of ringing them into silence', () => {
    // Calls signal and stream peer to peer: an unconnected member can never ring.
    const members: RosterMember[] = [{ id: 'max.lab', username: 'max.lab', displayName: 'Max Member' }];
    expect(callableMembers(members, peers, 10n, new Set())).toEqual({ callable: [], notConnected: ['Max Member'] });
  });
});
