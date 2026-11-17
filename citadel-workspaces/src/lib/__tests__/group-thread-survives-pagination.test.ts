/**
 * Scrolling up in a group chat must not delete the rest of the conversation.
 *
 * `handleMessagesLoaded` took a `prepend` flag that defaulted to false, and its
 * ONE caller never passed it — so the paging branch was dead code and an older
 * page REPLACED the whole transcript. Everything newer vanished from screen
 * until a new message arrived or the user reloaded. The prepend half was built;
 * the caller was never wired to it.
 */
import { describe, it, expect } from 'vitest';
import { mergeOlder, sortByTime, applyEdit, removeMessage } from '../group-message-list';
import type { GroupMessage } from '@/types/workspace-entities';

const msg = (id: string, t: number, content = id): GroupMessage =>
  ({ id, timestamp: BigInt(t), content } as unknown as GroupMessage);

describe('mergeOlder', () => {
  it('keeps the newer messages that are already on screen', () => {
    const onScreen: GroupMessage[] = [msg('c', 30), msg('d', 40)];
    const older: GroupMessage[] = [msg('a', 10), msg('b', 20)];

    const merged: GroupMessage[] = mergeOlder(onScreen, older);

    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not render a message twice when the pages overlap', () => {
    // A live message can land in the window while the older page is in flight,
    // and a non-paginated response can arrive while the flag is set. A blind
    // concat would show both copies.
    const onScreen: GroupMessage[] = [msg('b', 20), msg('c', 30)];
    const older: GroupMessage[] = [msg('a', 10), msg('b', 20)];

    const merged: GroupMessage[] = mergeOlder(onScreen, older);

    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('lets the newly-fetched copy win, so an edit made server-side lands', () => {
    const onScreen: GroupMessage[] = [msg('a', 10, 'stale')];
    const merged: GroupMessage[] = mergeOlder(onScreen, [msg('a', 10, 'fresh')]);
    expect(merged[0].content).toBe('fresh');
  });
});

describe('sortByTime', () => {
  it('orders oldest first without mutating its input', () => {
    const input: GroupMessage[] = [msg('b', 20), msg('a', 10)];
    const sorted: GroupMessage[] = sortByTime(input);
    expect(sorted.map((m) => m.id)).toEqual(['a', 'b']);
    expect(input.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('applyEdit / removeMessage', () => {
  it('edits only the named message', () => {
    const edited: GroupMessage[] = applyEdit([msg('a', 10), msg('b', 20)], 'b', 'new', 99n);
    expect(edited.map((m) => m.content)).toEqual(['a', 'new']);
    expect(edited[1].edited_at).toBe(99n);
  });

  it('removes only the named message', () => {
    expect(removeMessage([msg('a', 10), msg('b', 20)], 'a').map((m) => m.id)).toEqual(['b']);
  });
});

/**
 * The wiring, not just the arithmetic: the manager must actually take the merge
 * branch when the hook says an older page is coming. Without this the pure
 * function above would be correct and dead — which is exactly the state the
 * `prepend` parameter was in.
 */
describe('GroupMessagingManager pagination wiring', () => {
  it('merges when a load-older request is in flight, replaces otherwise', async () => {
    const { groupMessagingManager } = await import('../group-messaging-manager');
    groupMessagingManager.clearAll();

    groupMessagingManager.handleMessagesLoaded('g1', [msg('c', 30), msg('d', 40)], true);
    expect(groupMessagingManager.getMessages('g1').messages.map((m) => m.id)).toEqual(['c', 'd']);

    groupMessagingManager.markLoadingOlder('g1');
    groupMessagingManager.handleMessagesLoaded('g1', [msg('a', 10), msg('b', 20)], false);

    expect(groupMessagingManager.getMessages('g1').messages.map((m) => m.id)).toEqual([
      'a', 'b', 'c', 'd',
    ]);
  });

  it('replaces on a plain load, so switching groups does not accumulate', async () => {
    const { groupMessagingManager } = await import('../group-messaging-manager');
    groupMessagingManager.clearAll();

    groupMessagingManager.handleMessagesLoaded('g2', [msg('a', 10)], false);
    groupMessagingManager.handleMessagesLoaded('g2', [msg('z', 90)], false);

    expect(groupMessagingManager.getMessages('g2').messages.map((m) => m.id)).toEqual(['z']);
  });

  it('does not merge a later full load after a failed pagination', async () => {
    const { groupMessagingManager } = await import('../group-messaging-manager');
    groupMessagingManager.clearAll();

    groupMessagingManager.handleMessagesLoaded('g3', [msg('c', 30)], true);
    groupMessagingManager.markLoadingOlder('g3');
    // The request failed; the hook clears the flag so the next response is not
    // mistaken for the page that never arrived.
    groupMessagingManager.clearLoadingOlder('g3');
    groupMessagingManager.handleMessagesLoaded('g3', [msg('z', 90)], false);

    expect(groupMessagingManager.getMessages('g3').messages.map((m) => m.id)).toEqual(['z']);
  });
});
