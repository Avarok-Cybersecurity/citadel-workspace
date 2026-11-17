/**
 * "New message from alice" is a control, and it did nothing.
 *
 * Two ends, neither meeting:
 *
 *   1. `message-arrival-notification.ts` supplied the callback as `onOpen`,
 *      while `NotificationItem` reads `data.onCardClick`. Different key, so
 *      the click found nothing to run.
 *   2. The callback emitted `p2p:open-conversation`, and nothing anywhere
 *      listened for it.
 *
 * Either alone was enough, so fixing one would have looked like no change.
 *
 * A third, smaller thing sat beside them: `isClickable` — which decides the
 * pointer cursor and nothing else — required `type === PEER_REGISTRATION`, so
 * a message card gave the reader no sign it would do anything. The first
 * version of this file called that "not clickable", and a control proved
 * otherwise: restoring the type gate changed no behaviour and failed no test.
 * The affordance is asserted below on its own terms.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { eventEmitter } from '@/lib/event-emitter';
import { NotificationType, NotificationPriority, type Notification } from '@/lib/notification-service/types';
import NotificationItem from '../NotificationItem';
import { notifyMessageArrived } from '@/lib/p2p/message-arrival-notification';

function messageNotification(data: Record<string, unknown>): Notification {
  return {
    id: 'n1',
    type: NotificationType.MESSAGE,
    title: 'New message from alice',
    content: 'hello',
    timestamp: 1,
    read: false,
    priority: NotificationPriority.NORMAL,
    senderId: 'alice',
    data,
  } as unknown as Notification;
}

describe('a message notification card', () => {
  it('runs its callback when clicked', async () => {
    const onCardClick: ReturnType<typeof vi.fn> = vi.fn();
    render(
      <NotificationItem
        notification={messageNotification({ peerCid: '42', onCardClick })}
      />,
    );

    await userEvent.click(screen.getByText('New message from alice'));
    expect(onCardClick).toHaveBeenCalled();
  });

  it('does nothing when it was given nothing to do', async () => {
    // The positive control for the test above: a card that ran its callback
    // because every card runs something would prove nothing. Nothing to assert
    // being called, so this asserts the click is survivable and silent.
    render(<NotificationItem notification={messageNotification({ peerCid: '42' })} />);

    await userEvent.click(screen.getByText('New message from alice'));
    expect(screen.getByText('New message from alice')).toBeTruthy();
  });

  it('looks clickable exactly when it is', () => {
    // The cursor is the only thing `isClickable` governs, and it was gated on
    // the notification TYPE rather than on having a callback -- so a message
    // card that did something looked like text.
    const withCallback: ReturnType<typeof render> = render(
      <NotificationItem
        notification={messageNotification({ peerCid: '42', onCardClick: (): void => {} })}
      />,
    );
    expect(withCallback.container.querySelector('.cursor-pointer')).toBeTruthy();
    withCallback.unmount();

    const without: ReturnType<typeof render> = render(
      <NotificationItem notification={messageNotification({ peerCid: '42' })} />,
    );
    expect(without.container.querySelector('.cursor-pointer')).toBeNull();
  });
});

describe('the callback the message pipeline supplies', () => {
  it('is spelled the way the card reads it, and announces the peer', async () => {

    let supplied: Record<string, unknown> | undefined;
    const config: Record<string, unknown> = {
      shouldShowNotification: (): boolean => true,
      getConversations: (): Map<bigint, { peerUsername: string }> =>
        new Map([[42n, { peerUsername: 'alice' }]]),
      addNotification: (
        _t: string, _b: string, _s: string, _m: string, _r: string | undefined,
        options: Record<string, unknown>,
      ): void => { supplied = options; },
    };

    notifyMessageArrived(
      config as unknown as Parameters<typeof notifyMessageArrived>[0],
      42n,
      { id: 'm1', content: 'hello' } as unknown as Parameters<typeof notifyMessageArrived>[2],
    );

    // The key the card actually reads. It was `onOpen`.
    expect(typeof supplied?.onCardClick).toBe('function');

    const heard: unknown[] = [];
    const stop: () => void = eventEmitter.on('p2p:open-conversation', (p): void => { heard.push(p); });
    (supplied?.onCardClick as () => void)();
    stop();

    // The username too: the listener builds a URL from both, and a href
    // missing it lands on a conversation with no name.
    expect(heard).toEqual([{ peerCid: 42n, peerUsername: 'alice' }]);
  });
});
