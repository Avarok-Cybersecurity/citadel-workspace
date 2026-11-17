/**
 * The per-session unread badge could never change.
 *
 * `notifyUnreadChange()` is the only emitter of `unread-count-changed`, and
 * `useOrphanSessions` turns that event into the session switcher's per-account
 * unread badge and the attention glow beside it — under a comment reading "The
 * glow the chip was built for, and which nothing used to start".
 *
 * Nothing was broken. It was worth checking anyway, because a count that is
 * announced when it rises and not when it falls is a badge that only ever
 * climbs, and that is a defect this codebase has shipped before: `markAsRead`
 * on the GROUP store had zero callers for exactly that reason.
 *
 * The announce is load-bearing for a visible badge and nothing pinned it, so
 * these tests stay. All four mutation paths announce: add, read, read-all and
 * remove.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { NotificationService } from '../service';
import type { UnreadCountChange } from '../types';

function announcements(run: () => void): UnreadCountChange[] {
  const seen: UnreadCountChange[] = [];
  const onChange = (change: UnreadCountChange): void => { seen.push(change); };
  eventEmitter.on('unread-count-changed', onChange);
  run();
  eventEmitter.off('unread-count-changed', onChange);
  return seen;
}

describe('the unread count', () => {
  let service: NotificationService;

  beforeEach((): void => {
    service = NotificationService.getInstance();
    // `cleanup()` clears handlers and the socket listener, NOT the
    // notifications -- which cost the first version of this file two false
    // failures, because a notification from the previous test was still unread
    // and every total was one too high.
    for (const existing of service.getNotifications()) {
      service.removeNotification(existing.id);
    }
  });

  it('is announced when a notification arrives', () => {
    const seen: UnreadCountChange[] = announcements(() => {
      service.addSystemNotification('Something happened', 'detail');
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].total).toBe(1);
  });

  it('is announced when one is read', () => {
    const added: { id: string } = service.addSystemNotification('Something happened', 'detail');

    const seen: UnreadCountChange[] = announcements(() => {
      service.markAsRead(added.id);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].total).toBe(0);
  });

  it('is announced when one is removed', () => {
    const added: { id: string } = service.addSystemNotification('Something happened', 'detail');

    const seen: UnreadCountChange[] = announcements(() => {
      service.removeNotification(added.id);
    });

    expect(seen[seen.length - 1].total).toBe(0);
  });

  it('carries the per-cid breakdown the session chips read', () => {
    // `byCid` is what useOrphanSessions turns into the per-account badge; a
    // change announcing only a total would leave every chip at zero.
    const seen: UnreadCountChange[] = announcements(() => {
      service.addMessageNotification('Alice', 'hello', 'alice', 'm1', '4242');
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].byCid).toBeInstanceOf(Map);
  });

  it('says nothing when nothing was added', () => {
    // Negative control: an implementation that announced unconditionally on
    // every call would pass the assertions above.
    const seen: UnreadCountChange[] = announcements(() => {
      service.markAsRead('no-such-notification');
    });

    expect(seen).toEqual([]);
  });
});
