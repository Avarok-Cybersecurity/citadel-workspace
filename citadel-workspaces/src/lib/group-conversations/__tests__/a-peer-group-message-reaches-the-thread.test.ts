/**
 * Round 470 shipped the sidebar half and not the thread half.
 *
 * A peer-group message became `group:message-received`, which the store reads
 * for the unread badge, the preview and the recency sort. The open conversation
 * does not read that event at all: `useGroupChat` subscribes to
 * `groupMessagingManager.subscribeToGroup`, and the workspace path feeds that
 * by calling `handleNewMessage` directly.
 *
 * So a peer-group message would have updated the sidebar and never appeared in
 * the chat you were looking at. The same shape the round before it fixed, one
 * layer up — which is why this is asserted rather than assumed.
 *
 * The id matters as much as the delivery. ILM redelivers: round 465 measured
 * one operation retransmitted 91 times. `handleNewMessage` dedupes by message
 * id, so the id has to come from the SENDER and survive redelivery — minting a
 * fresh uuid on arrival would turn every redelivery into another copy in the
 * transcript.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const delivered: Array<{ groupId: string; id: string; content: string; sender: string }> = [];

vi.mock('@/lib/group-messaging-manager', () => ({
  groupMessagingManager: {
    handleNewMessage: (groupId: string, message: { id: string; content: string; sender_id: string }): void => {
      delivered.push({ groupId, id: message.id, content: message.content, sender: message.sender_id });
    },
    // startGroupEventBindings also binds the transcript recorder to the manager.
    subscribe: (): (() => void) => (): void => {},
  },
}));

const { deliverPeerGroupMessage } = await import('../peer-group-delivery');

const GROUP: string = '7:42';

describe('a peer-group message reaching the open conversation', () => {
  beforeEach((): void => { delivered.length = 0; });

  it('is handed to the thread, not only to the sidebar', () => {
    deliverPeerGroupMessage({
      groupId: GROUP, messageId: 'm-1', senderId: '7', senderName: 'ada',
      content: 'hello', timestamp: 1_000,
    });

    expect(delivered).toEqual([{ groupId: GROUP, id: 'm-1', content: 'hello', sender: '7' }]);
  });

  it('keeps the id the sender minted, so a redelivery is the same message', () => {
    // Two arrivals of one message. handleNewMessage dedupes by id; a fresh uuid
    // per arrival would defeat that and print the message twice.
    const payload: { groupId: string; messageId: string; senderId: string; senderName: string; content: string; timestamp: number } = {
      groupId: GROUP, messageId: 'm-1', senderId: '7', senderName: 'ada',
      content: 'hello', timestamp: 1_000,
    };
    deliverPeerGroupMessage(payload);
    deliverPeerGroupMessage(payload);

    expect(delivered.map((d) => d.id)).toEqual(['m-1', 'm-1']);
  });
});

/**
 * The binding, not the helper.
 *
 * Deleting the bind call would leave every test above green: they call
 * `deliverPeerGroupMessage` directly. This drives the event the store emits.
 */
describe('the binding from the event to the thread', () => {
  beforeEach((): void => { delivered.length = 0; });

  it('delivers a peer-group message', async () => {
    const { bindPeerGroupDelivery } = await import('../bind-peer-group-delivery');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const stop: () => void = bindPeerGroupDelivery();

    eventEmitter.emit('group:message-received', {
      groupId: GROUP, messageId: 'm-9', senderId: '7', senderName: 'ada',
      content: 'hello', timestamp: 1_000,
    });
    stop();

    expect(delivered).toEqual([{ groupId: GROUP, id: 'm-9', content: 'hello', sender: '7' }]);
  });

  it('leaves a workspace chat channel alone', async () => {
    // The workspace path hands its own messages to the thread already. Doing it
    // here as well would print every workspace message twice.
    const { bindPeerGroupDelivery } = await import('../bind-peer-group-delivery');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const stop: () => void = bindPeerGroupDelivery();

    eventEmitter.emit('group:message-received', {
      groupId: '9f3c1e2a-0000-4000-8000-000000000001', messageId: 'm-9',
      senderId: '7', senderName: 'ada', content: 'hello', timestamp: 1_000,
    });
    stop();

    expect(delivered).toEqual([]);
  });

  it('drops a message with no id rather than duplicating it later', async () => {
    const { bindPeerGroupDelivery } = await import('../bind-peer-group-delivery');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const stop: () => void = bindPeerGroupDelivery();

    eventEmitter.emit('group:message-received', {
      groupId: GROUP, senderId: '7', content: 'hello',
    });
    stop();

    expect(delivered).toEqual([]);
  });
});

/**
 * The registration, not the binding.
 *
 * A third control was needed. Commenting out `bindPeerGroupDelivery()` in
 * `startGroupEventBindings` left every test above green, because they call the
 * binding themselves. Helper, wiring, registration -- each layer passes while
 * the one below it is missing, which is how a feature ends up built from one
 * end.
 */
describe('the store registers the delivery binding', () => {
  it('delivers without anyone calling the binding by hand', async () => {
    delivered.length = 0;
    const { startGroupEventBindings } = await import('../group-store');
    const { eventEmitter } = await import('@/lib/event-emitter');

    startGroupEventBindings(noSessionUsername);
    eventEmitter.emit('group:message-received', {
      groupId: GROUP, messageId: 'm-registered', senderId: '7', senderName: 'ada',
      content: 'hello', timestamp: 1_000,
    });

    expect(delivered.map((d) => d.id)).toContain('m-registered');
  });
});
