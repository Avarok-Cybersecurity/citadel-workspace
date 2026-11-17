/**
 * The Messages page names a contact the way the sidebar does.
 *
 * Found live (2026-09-29): the sidebar showed "Thomas Braun" and /messages
 * listed the same conversation as "Peer D7U2E0". The page used the
 * conversation record's username alone, which a conversation created from an
 * incoming message does not carry; the sidebar takes it from the registered
 * peer.
 */
import { describe, it, expect } from 'vitest';
import { conversationPeerName } from '../P2PPeerListHelpers';
import type { Peer } from '@/lib/p2p-registration-service';

const THOMAS_CID: bigint = 8971774964460040856n;
const thomas: Peer = { cid: THOMAS_CID, username: 'tbraun96', fullName: 'Thomas Braun', isOnline: null } as Peer;

describe('conversationPeerName', () => {
  it('takes the registered peer\'s name when the conversation has no username', () => {
    expect(conversationPeerName(THOMAS_CID, undefined, [thomas])).toBe('Thomas Braun');
  });

  it('prefers the registered full name to a bare username on the conversation', () => {
    expect(conversationPeerName(THOMAS_CID, 'tbraun96', [thomas])).toBe('Thomas Braun');
  });

  it('falls back to the handle only for a peer nobody registered', () => {
    expect(conversationPeerName(THOMAS_CID, undefined, [])).toBe('Peer D7U2E0');
  });

  it('matches by CID, not by position', () => {
    const other: Peer = { ...thomas, cid: 1n, fullName: 'Someone Else', username: 'else' } as Peer;
    expect(conversationPeerName(THOMAS_CID, undefined, [other, thomas])).toBe('Thomas Braun');
  });
});
