/**
 * A connection-request card's avatar read "53": the first two characters of
 * the requester's CID (live 09-26, Hana High → Nia). The avatar is the
 * person's initials, from the same name the title uses -- or nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationPriority, NotificationType, type Notification } from '@/lib/notification-service/types';
import { peerRegistrationNotification } from '@/lib/notification-service/peer-registration-notification';
import NotificationItem from '../NotificationItem';

function card(overrides: Partial<Notification>): Notification {
  return { id: 'n1', type: NotificationType.SYSTEM, title: 'T', content: 'c', timestamp: 1, read: false, priority: NotificationPriority.NORMAL, ...overrides };
}

describe('a notification card avatar', () => {
  it("shows the sender's initials, never digits of their CID", () => {
    render(<NotificationItem notification={card({ senderId: '5391274032', senderName: 'Hana High' })} />);
    expect(screen.getByText('HH')).toBeInTheDocument();
    expect(screen.queryByText('53')).toBeNull();
  });

  it('shows no avatar when the sender has no name', () => {
    render(<NotificationItem notification={card({ senderId: '5391274032' })} />);
    expect(screen.queryByText('53')).toBeNull();
  });

  it('names the requester of a connection request, the same name as its title', () => {
    const n: Omit<Notification, 'id' | 'timestamp' | 'read'> = peerRegistrationNotification({
      peerUsername: 'hana87108.lab', peerCid: '5391274032', requestId: 'r', onAccept: (): void => {}, onDecline: (): void => {}, onCardClick: (): void => {},
    });
    expect(n.title).toBe(`${n.senderName} wants to connect`);
  });
});
