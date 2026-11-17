/**
 * `applyGroupMessage` lacked both guards its siblings carry.
 *
 * `apply-group-settings`, `rename-group` and `mark-group-read` each refuse a
 * change for a group the store does not have, and each returns `prev` when
 * nothing actually changed — because `map` always allocates, and the store
 * notifies on every new array. This one mapped unconditionally:
 *
 *   - a message for an unknown group produced a fresh array, a store
 *     notification and an IndexedDB write for a change nobody made;
 *   - a redelivered message added another to the unread badge for a message
 *     already counted. The transport redelivers by design — that is what makes
 *     it reliable — so this is routine, not an edge case.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let currentCid: bigint | null = 111n;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return currentCid; } }) };
});

const { applyGroupMessage } = await import('../apply-group-message');
const { forgetSeenIds } = await import('@/lib/seen-ids');
import type { GroupConversation } from '@/types/group';

const GROUP: string = 'group-1';
const OTHER: string = '222';

function groups(): GroupConversation[] {
  return [{ id: GROUP, unreadCount: 0, lastMessageTime: 0, lastMessagePreview: '' } as unknown as GroupConversation];
}

function message(overrides: Record<string, unknown> = {}): { groupId: string; senderId: string; content: string; messageId?: string; viewing: boolean } {
  // Not looking at it: the counting rules are the subject here, not the viewing one.
  return { groupId: GROUP, senderId: OTHER, content: 'hello', messageId: 'm1', viewing: false, ...overrides };
}

describe('a group message', () => {
  beforeEach((): void => { currentCid = 111n; forgetSeenIds(); });

  it('counts a new message once', () => {
    const next: GroupConversation[] = applyGroupMessage(groups(), message(), 5, (cid: bigint): string => cid.toString());
    expect(next[0].unreadCount).toBe(1);
    expect(next[0].lastMessagePreview).toBe('hello');
  });

  it('does not count a redelivery again', () => {
    const first: GroupConversation[] = applyGroupMessage(groups(), message(), 5, (cid: bigint): string => cid.toString());
    const second: GroupConversation[] = applyGroupMessage(first, message(), 6, (cid: bigint): string => cid.toString());

    expect(second[0].unreadCount, 'the badge counted the same message twice').toBe(1);
    // And no new array, so nothing notifies or writes.
    expect(second, 'a redelivery still allocated a new list').toBe(first);
  });

  it('counts two genuinely different messages', () => {
    // The opposite failure: a dedupe keyed too broadly would swallow real
    // messages, and the assertion above cannot tell the two apart.
    const first: GroupConversation[] = applyGroupMessage(groups(), message({ messageId: 'm1' }), 5, (cid: bigint): string => cid.toString());
    const second: GroupConversation[] = applyGroupMessage(first, message({ messageId: 'm2' }), 6, (cid: bigint): string => cid.toString());

    expect(second[0].unreadCount).toBe(2);
  });

  it('returns the same list for a group it does not have', () => {
    const before: GroupConversation[] = groups();
    const after: GroupConversation[] = applyGroupMessage(before, message({ groupId: 'nope' }), 5, (cid: bigint): string => cid.toString());

    expect(after, 'an unknown group still allocated, notified and wrote').toBe(before);
  });

  it('still ignores an id it has never seen when none is supplied', () => {
    // The emitter may not carry one. Refusing to count then would silently drop
    // real messages, which is worse than counting a rare duplicate.
    const first: GroupConversation[] = applyGroupMessage(groups(), message({ messageId: undefined }), 5, (cid: bigint): string => cid.toString());
    const second: GroupConversation[] = applyGroupMessage(first, message({ messageId: undefined }), 6, (cid: bigint): string => cid.toString());

    expect(second[0].unreadCount).toBe(2);
  });

  it('does not count your own echo', () => {
    // Pre-existing and preserved: the server answers the sender with the same
    // notification it broadcasts, and that echo is what confirms the send.
    const next: GroupConversation[] = applyGroupMessage(groups(), message({ senderId: '111' }), 5, (cid: bigint): string => cid.toString());
    expect(next[0].unreadCount).toBe(0);
  });
});

/**
 * The dedupe is only reachable if the emitter supplies an id.
 *
 * `messageId` is deliberately optional — an emitter that has none must still be
 * able to deliver a real message, and refusing then would drop it. That makes
 * the absence invisible to every test above: removing `messageId` from the emit
 * site leaves all six green while the badge silently double-counts again.
 * Verified by control.
 *
 * So this reads the emit site. There is exactly one producer of this event.
 */
describe('the emitter of group:message-received', () => {
  it('supplies the message id the store dedupes on', () => {
    const source: string = readFileSync(
      join(process.cwd(), 'src/lib/workspace-response-handler/group-handlers.ts'),
      'utf8',
    );
    const emit: number = source.indexOf("eventEmitter.emit('group:message-received'");
    expect(emit, 'nothing emits group:message-received any more').toBeGreaterThan(-1);

    const payload: string = source.slice(emit, source.indexOf('});', emit));
    expect(
      payload,
      'the emit site no longer carries messageId, so applyGroupMessage cannot \
dedupe and every redelivery inflates the unread badge again',
    ).toContain('messageId:');
  });
});
