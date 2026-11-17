/**
 * A notice sits in a neutral row; its priority tints only the leading chip.
 *
 * Live 10-02 every card was outlined in glowing purple: the priority colour
 * painted the card's whole border, on top of a 4px left bar and a shadow.
 * jsdom has no paint, so this pins the classes that produced it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NotificationPriority, NotificationType, type Notification } from '@/lib/notification-service/types';
import NotificationItem from '../NotificationItem';

function card(priority: NotificationPriority): Notification {
  return { id: 'n', type: NotificationType.MESSAGE, title: 'New message from Thomas Braun', content: "I'm good!", timestamp: 1, read: false, priority };
}

describe('a notification card', () => {
  for (const priority of [NotificationPriority.HIGH, NotificationPriority.NORMAL, NotificationPriority.LOW]) {
    it(`at ${priority} priority keeps a neutral frame`, () => {
      const { container } = render(<NotificationItem notification={card(priority)} />);
      const root: Element | null = container.firstElementChild;
      expect(root?.className).toMatch(/\bborder-border\b/);
      expect(root?.className).toMatch(/\bshadow-none\b/);
      expect(root?.className).not.toMatch(/border-l-4|border-primary-accent(?!\/)|border-destructive|shadow-(sm|md|lg|xl)\b/);
    });
  }
});
