/**
 * The receiving half of peer-group chat.
 *
 * `InternalServiceRequest::GroupMessage` had no sender in this client, and its
 * `GroupMessageNotification` had no handler either — the only handler for that
 * name is in `workspace-response-handler/group-handlers.ts`, for the WORKSPACE
 * protocol's notification, which is a different shape entirely:
 * `{ group_id, message }` there, `{ cid, peer_cid, message: number[],
 * group_key, request_id }` here.
 *
 * Written in the same change as the sender. A send with nothing listening is
 * the shape that has cost this campaign more findings than any other.
 */
import { describe, it, expect } from 'vitest';
import { peerGroupMessageEvent, type PeerGroupMessageSummary } from '../peer-group-inbound';
import { encodeGroupMessage } from '../group-message-codec';
import { toGroupEvents } from '../group-events';

const peerName = (cid: bigint): string => (cid === 7n ? 'ada' : cid.toString());

const GROUP: string = '7:42';

function notification(body: Uint8Array): Record<string, unknown> {
  return { cid: 111n, peer_cid: 7n, message: Array.from(body), group_key: { cid: 7n, mgid: 42n }, request_id: 'r1' };
}

describe('a peer-group message arriving', () => {
  it('reaches the group it was sent to, named by the roster', () => {
    const body: Uint8Array = encodeGroupMessage({
      group_id: GROUP, message_id: 'm-1', sender_cid: 7n, content: 'hello', timestamp: 1_000,
    });

    const event: PeerGroupMessageSummary | null = peerGroupMessageEvent(notification(body), peerName);

    expect(event).toEqual({
      groupId: GROUP, messageId: 'm-1', senderId: '7', senderName: 'ada', content: 'hello', timestamp: 1_000,
    });
  });

  it('produces nothing, and does not throw, on a body it cannot read', () => {
    // A peer on a different build, or a stray payload. Throwing here would
    // take down the handling of every message queued behind it.
    const event: PeerGroupMessageSummary | null =
      peerGroupMessageEvent(notification(new Uint8Array([0xff, 0xff, 0xff])), peerName);

    expect(event).toBeNull();
  });

  it('trusts the group key over the body it was handed', () => {
    // The envelope is written by the sender and the key is the protocol's. A
    // body claiming another group would otherwise file the message there --
    // which is how a message lands in a conversation it was never sent to.
    const body: Uint8Array = encodeGroupMessage({
      group_id: '9:99', message_id: 'm-1', sender_cid: 7n, content: 'hello', timestamp: 1_000,
    });

    expect(peerGroupMessageEvent(notification(body), peerName)?.groupId).toBe(GROUP);
  });
});

/**
 * The wiring, not the translator.
 *
 * Deleting the branch in `toGroupEvents` left every test above green: they
 * drive `peerGroupMessageEvent` directly. A control proved it, so this drives
 * the real translator the response service calls.
 */
describe('the notification reaching the group events translator', () => {
  it('becomes the same group:message-received the store already reads', () => {
    const body: Uint8Array = encodeGroupMessage({
      group_id: GROUP, message_id: 'm-1', sender_cid: 7n, content: 'hello', timestamp: 1_000,
    });

    const events: ReturnType<typeof toGroupEvents> = toGroupEvents(
      { GroupMessageNotification: notification(body) },
      111n,
      'me',
      peerName,
    );

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('group:message-received');
    expect(events[0].payload).toMatchObject({ groupId: GROUP, senderId: '7', content: 'hello' });
  });

  it('produces no event at all for a body it cannot read', () => {
    const events: ReturnType<typeof toGroupEvents> = toGroupEvents(
      { GroupMessageNotification: notification(new Uint8Array([0xff, 0xff, 0xff])) },
      111n,
      'me',
      peerName,
    );

    expect(events).toEqual([]);
  });
});
