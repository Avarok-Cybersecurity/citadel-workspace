/**
 * A read-sweep must hand handlers only what it changed.
 *
 * The store is insert-only in normal operation (`cleanup()` has no callers, as
 * its own doc comment admits), and `markRead` used to finish by re-delivering
 * EVERY stored notification to EVERY handler — so each bell open replayed the
 * whole ever-growing history, including other sessions' notifications and ones
 * long since read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotificationService } from '../service';
import type { Notification } from '../types';

const ALICE: string = '111';
const BOB: string = '222';

describe('the read-sweep handler fan-out', () => {
  let service: NotificationService;
  let received: Notification[];
  let unregister: () => void;

  beforeEach(() => {
    service = NotificationService.getInstance();
    // Singleton shared across the file; each test removes what it added.
    for (const existing of service.getNotifications()) {
      service.removeNotification(existing.id);
    }
    received = [];
    unregister = service.registerNotificationHandler((n) => { received.push(n); });
  });

  afterEach(() => { unregister(); });

  it('delivers exactly the notifications the sweep changed', () => {
    service.addMessageNotification('Alice', 'hi', 'a', 'm1', ALICE);
    service.addMessageNotification('Bob', 'hi', 'b', 'm2', BOB);
    received.length = 0;

    service.markAllAsReadForCid(ALICE);

    // Bob's untouched notification must not be replayed to the handlers.
    expect(received.map((n) => n.recipientCid)).toEqual([ALICE]);
    expect(received[0].read).toBe(true);
  });

  it('delivers nothing when the sweep changed nothing', () => {
    service.addMessageNotification('Alice', 'hi', 'a', 'm1', ALICE);
    service.markAllAsReadForCid(ALICE);
    received.length = 0;

    // The second bell open: everything is already read.
    service.markAllAsReadForCid(ALICE);

    expect(received).toEqual([]);
  });

  it('still notifies on arrival and on a single read (opposite direction)', () => {
    // Without these, "never call handlers at all" would pass the tests above.
    const added: Notification =
      service.addMessageNotification('Alice', 'hi', 'a', 'm1', ALICE);
    expect(received).toHaveLength(1);

    service.markAsRead(added.id);
    expect(received).toHaveLength(2);
    expect(received[1].read).toBe(true);
  });
});
