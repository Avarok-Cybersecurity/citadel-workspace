/**
 * Group chat produced no notification of any kind.
 *
 * `addMessageNotification` had exactly two callers — the P2P manager and a
 * dev-only simulator — so the entire group pipeline updated the sidebar badge
 * and stopped there. No bell entry, no OS notification, no sound, and the
 * backgrounded-tab path unreachable for groups entirely. Someone working in
 * another window learned of group traffic only by happening to look at the
 * sidebar.
 */

import { describe, it, expect, vi, beforeEach    } from 'vitest';

const addMessageNotification: ReturnType<typeof vi.fn> = vi.fn();
vi.mock('@/lib/notification-service', () => ({
  default: { getInstance: (): { addMessageNotification: ReturnType<typeof vi.fn> } => ({ addMessageNotification }) },
  NotificationPriority: { HIGH: 'high', NORMAL: 'normal' },
}));

const cidRef: { current: bigint | null; } = { current: null as bigint | null };
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: { get cid(): bigint | null { return cidRef.current; } },
}));

const usernameRef: { current: string | undefined } = { current: 'thomas' };

const { eventEmitter } = await import('@/lib/event-emitter');
const { markChannelOpen } = await import('../open-channel');
const { startGroupNotificationBindings } = await import('../group-notifications');

startGroupNotificationBindings((): string | undefined => usernameRef.current);

function receive(senderId: string, content: string = 'hello', groupId: string = 'g1'): void {
  eventEmitter.emit('group:message-received', {
    groupId,
    senderId,
    senderName: 'Ana',
    content,
  });
}

describe('an incoming group message', () => {
  beforeEach(() => {
    addMessageNotification.mockClear();
    // The window is in front unless a test says otherwise; jsdom's hasFocus is false.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    cidRef.current = 100n;
    window.history.replaceState({}, '', '/workspace');
  });

  it('raises a notification', () => {
    receive('200');
    expect(addMessageNotification).toHaveBeenCalledTimes(1);
  });

  it('names the sender, so the bell says who it is from', () => {
    receive('200');
    expect(addMessageNotification.mock.calls[0][0]).toBe('Ana');
  });

  it('does not ring for your own message', () => {
    // The server answers the SENDER with the same notification it broadcasts to
    // everyone else -- that echo is what confirms a send -- so without this
    // every message you sent would ring your own bell.
    receive('100');
    expect(addMessageNotification).not.toHaveBeenCalled();
  });

  it('does not ring for your own office/room message, whose sender is your username', () => {
    // Live (owner, 2026-09-27): an office channel's sender_id is the account USERNAME, so the
    // CID-only check never matched and every message you sent rang your own bell.
    receive('thomas');
    expect(addMessageNotification).not.toHaveBeenCalled();
  });

  it('does not ring for the office/room chat open on screen', () => {
    const close: () => void = markChannelOpen('chan-1');
    receive('200', 'hello', 'chan-1');
    close();
    expect(addMessageNotification).not.toHaveBeenCalled();
    receive('200', 'hello again', 'chan-1');
    expect(addMessageNotification).toHaveBeenCalledTimes(1);
  });

  it('does not ring for the group you are reading right now', () => {
    window.history.replaceState({}, '', '/groups/g1');
    receive('200');
    expect(addMessageNotification).not.toHaveBeenCalled();
  });

  it('rings for the group on screen while the window is behind another app', () => {
    // Visible is not seen: the window on screen behind another app is not read.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    window.history.replaceState({}, '', '/groups/g1');
    receive('200');
    const close: () => void = markChannelOpen('chan-1');
    receive('200', 'hello', 'chan-1');
    close();
    expect(addMessageNotification).toHaveBeenCalledTimes(2);
  });

  it('still rings for a different group while you read one', () => {
    window.history.replaceState({}, '', '/groups/g1');
    receive('200', 'hello', 'g2');
    expect(addMessageNotification).toHaveBeenCalledTimes(1);
  });

  it('keys a redelivered message to the same id, so it cannot stack', () => {
    receive('200', 'same text');
    receive('200', 'same text');

    const [first, second] = addMessageNotification.mock.calls;
    expect(first[3]).toBe(second[3]);
  });
});
