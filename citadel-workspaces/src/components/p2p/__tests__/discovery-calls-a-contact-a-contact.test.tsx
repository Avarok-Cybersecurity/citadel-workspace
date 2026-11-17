/**
 * Peer Discovery says someone is a contact, not that they are connected.
 *
 * Found live (2026-09-29): Thomas Braun was offline -- the sidebar said so --
 * and Peer Discovery showed him "Connected". The badge meant "registered", which
 * the pause menu and the rest of the app call a contact; presence has its own
 * badge beside it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeerListItem } from '../PeerListItem';
import type { Peer } from '../usePeerDiscovery';
import { UserProfileCard } from '@/pages/UserProfileCard';
import type { UserData } from '@/components/user/UserSearch';

function row(peer: Peer, isRegistered: boolean): void {
  render(
    <PeerListItem peer={peer} isRegistered={isRegistered} isOutgoing={false} incomingRequest={undefined}
      acceptingPeerCid={null} onAccept={() => undefined} onRegister={() => undefined} />,
  );
}

const thomas: Peer = { cid: '8971774964460040856', username: 'tbraun96', fullName: 'Thomas Braun', is_online: false };

describe('a registered peer in Peer Discovery', () => {
  it('reads as a contact, and does not claim a connection while offline', () => {
    row(thomas, true);
    expect(screen.getByTestId('peer-contact-badge')).toHaveTextContent('Contact');
    expect(screen.queryByText(/connected/i)).toBeNull();
  });

  it('shows Online beside it only when the peer is online', () => {
    row({ ...thomas, is_online: true }, true);
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByTestId('peer-contact-badge')).toBeInTheDocument();
  });

  it('has no contact badge for someone who is not a contact', () => {
    row(thomas, false);
    expect(screen.queryByTestId('peer-contact-badge')).toBeNull();
  });
});

describe('the directory profile card', () => {
  // Same meaning, same word: `isConnected` there is "is a registered peer".
  const user: UserData = { id: 'tbraun96', displayName: 'Thomas Braun', isOnline: false };
  const card = (isConnected: boolean): JSX.Element => (
    <UserProfileCard selectedUser={user} isSelf={false} isConnected={isConnected}
      onClose={() => undefined} onSendMessage={() => undefined} onInvite={() => undefined} />
  );

  it('calls a contact a contact', () => {
    render(card(true));
    expect(screen.getByText('In your contacts')).toBeInTheDocument();
    expect(screen.queryByText(/connected/i)).toBeNull();
  });

  it('calls anyone else not a contact yet', () => {
    render(card(false));
    expect(screen.getByText('Not a contact yet')).toBeInTheDocument();
    expect(screen.queryByText(/connected/i)).toBeNull();
  });
});
