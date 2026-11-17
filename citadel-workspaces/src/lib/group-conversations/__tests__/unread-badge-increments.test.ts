/**
 * The sidebar's unread badge, last-message preview and recency sort all hang off
 * `group:message-received` — which NOTHING emitted. The inbound path emitted
 * `group:message:new`. Two half-built pipes that never met: the badge never
 * incremented for any message ever, and the recency sort never reordered
 * because `lastMessageTime` was never set.
 *
 * This drives the real response handler, so it fails if the emit is removed OR
 * if its payload stops matching what the store reads.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { handleGroupVariants } from '../../workspace-response-handler/group-handlers';

describe('an incoming group message', () => {
  it('emits the event the sidebar badge actually listens for', () => {
    const seen: Array<Record<string, unknown>> = [];
    const listener = (p: unknown): number => seen.push(p as Record<string, unknown>);
    eventEmitter.on('group:message-received', listener);

    try {
      handleGroupVariants(
        {
          GroupMessageNotification: {
            group_id: 'g1',
            message: { id: 'm1', sender_id: 'ada', content: 'hello there' },
          },
        } as never,
        {} as never,
      );
    } finally {
      eventEmitter.off('group:message-received', listener);
    }

    expect(seen).toHaveLength(1);
    // The exact shape group-store destructures. A payload the store cannot read
    // is the same defect one layer along.
    expect(seen[0]).toMatchObject({ groupId: 'g1', senderId: 'ada', content: 'hello there' });
  });
});
