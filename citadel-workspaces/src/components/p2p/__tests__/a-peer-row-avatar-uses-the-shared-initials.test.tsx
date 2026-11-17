/**
 * Avatar fallbacks were hand-rolled per surface (first character here, a first
 * and last there). A row now shows the same initials every other surface does.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationPeerItem } from '../ConversationPeerItem';
import { MemberListItem } from '@/pages/MemberListItem';

describe('avatar fallbacks', () => {
  it('a P2P row shows first and last initials', () => {
    render(
      <ConversationPeerItem
        peer={{ cid: '1', name: 'Ada Byron Lovelace', username: 'ada', isConnected: true, unreadCount: 0 }}
        isSelected={false}
        onSelect={(): void => undefined}
      />,
    );
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('a directory row shows the same', () => {
    render(
      <MemberListItem
        member={{ id: 'ada', displayName: 'Ada Byron Lovelace', isOnline: null, isSelf: false, isContact: false }}
        variant="all"
        onSendMessage={(): void => undefined}
        onInvite={(): void => undefined}
        onSelect={(): void => undefined}
      />,
    );
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});
