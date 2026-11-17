/**
 * Accept and Decline on the in-app notification ran the store's action and, when
 * it threw, wrote a debug line: the person pressed Accept, the card went on
 * saying a request was waiting, and nothing said it had not been accepted. The
 * request modal toasts the same failure; the notification said nothing.
 *
 * Doubled: the notification service only (the UI surface), so the card's two
 * callbacks can be pressed and what it was told can be read. The failure is the
 * action's own rejection, not a stand-in for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h: {
  pressed: { accept?: () => void; decline?: () => void };
  told: Array<{ title: string; content: string; recipientCid?: string }>;
} = vi.hoisted(() => ({ pressed: {}, told: [] }));

vi.mock('../../notification-service', () => ({
  NotificationPriority: { HIGH: 'HIGH' },
  notificationService: {
    addPeerRegistrationNotification: (...args: unknown[]): void => {
      h.pressed = { accept: args[3] as () => void, decline: args[4] as () => void };
    },
    addSystemNotification: (title: string, content: string, _priority: unknown, recipientCid?: string): void => {
      h.told.push({ title, content, recipientCid });
    },
  },
}));

import { createNotificationWithCallbacks } from '../lifecycle';
import type { PendingPeerRequest } from '../types';

const request: PendingPeerRequest = { id: 'req-1', cid: 7n, peer_cid: 42n, peer_username: 'alice' } as PendingPeerRequest;

beforeEach(() => { h.pressed = {}; h.told = []; });

describe('the notification card for a peer request', () => {
  it('says so when Accept fails', async () => {
    createNotificationWithCallbacks(request, () => Promise.reject(new Error('socket down')), () => Promise.resolve());
    h.pressed.accept?.();
    await vi.waitFor(() => expect(h.told).toHaveLength(1));
    expect(h.told[0].title).toBe('Could not accept the request from alice');
    expect(h.told[0].content).toContain('socket down');
    expect(h.told[0].recipientCid).toBe('7');
  });

  it('says so when Decline fails', async () => {
    createNotificationWithCallbacks(request, () => Promise.resolve(), () => Promise.reject(new Error('socket down')));
    h.pressed.decline?.();
    await vi.waitFor(() => expect(h.told).toHaveLength(1));
    expect(h.told[0].title).toBe('Could not decline the request from alice');
  });

  it('says nothing when the action works', async () => {
    createNotificationWithCallbacks(request, () => Promise.resolve(), () => Promise.resolve());
    h.pressed.accept?.();
    h.pressed.decline?.();
    await Promise.resolve();
    expect(h.told).toEqual([]);
  });
});
