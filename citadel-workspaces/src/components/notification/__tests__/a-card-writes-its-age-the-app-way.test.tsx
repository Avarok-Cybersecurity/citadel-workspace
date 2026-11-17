/**
 * A notification said "about 3 hours ago" (date-fns) where every other surface
 * says "3 hours ago"; the card, the pending-requests list and the last-active
 * line now share formatRelative.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationPriority, NotificationType, type Notification } from '@/lib/notification-service/types';
import NotificationItem from '../NotificationItem';

describe('a notification card age', () => {
  it('reads like every other relative time in the app', () => {
    const n: Notification = {
      id: 'n1', type: NotificationType.SYSTEM, title: 'T', content: 'c',
      timestamp: Date.now() - 3 * 60 * 60 * 1000 - 5_000, read: false, priority: NotificationPriority.NORMAL,
    };
    render(<NotificationItem notification={n} />);
    expect(screen.getByText('3 hours ago')).toBeInTheDocument();
  });
});
