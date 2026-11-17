/**
 * The same backlog reads the same on every conversation list: the group row
 * capped at "99+", the peer rows printed the raw number.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatUnreadCount } from '@/lib/format-unread';
import { ConversationPeerItem } from '../ConversationPeerItem';

describe('formatUnreadCount', () => {
  it('writes counts up to the cap as they are, and beyond it as the cap plus', () => {
    expect(formatUnreadCount(7)).toBe('7');
    expect(formatUnreadCount(99)).toBe('99');
    expect(formatUnreadCount(100)).toBe('99+');
  });
});

describe('a P2P conversation row', () => {
  it('caps its unread badge the way the group row does', () => {
    render(
      <ConversationPeerItem
        peer={{ cid: '1', name: 'alice', username: 'alice', isConnected: true, unreadCount: 150 }}
        isSelected={false}
        onSelect={(): void => undefined}
      />,
    );
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.queryByText('150')).toBeNull();
  });
});
