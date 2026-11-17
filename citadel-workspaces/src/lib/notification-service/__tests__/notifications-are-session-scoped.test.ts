/**
 * One tab must never show another account's notifications.
 *
 * `recipientCid` was recorded on every notification and plumbed all the way to
 * `getUnreadCountByCid` — and the panel that actually renders them ignored it,
 * filtering only by notification TYPE. Message notifications carry a
 * 100-character plaintext preview and the sender's name, so a tab that switched
 * accounts — the workspace-switcher / ClaimSession flow this product is built
 * around — rendered the previous account's messages to the new one, and
 * markAllAsRead marked them read as the new account. `cleanup()` has no callers,
 * so nothing clears them on logout either.
 */
import { describe, it, expect } from 'vitest';
import { notificationBelongsTo } from '../types';

const ALICE: string = '111';
const BOB: string = '222';

describe('notification session scoping', () => {
  it('shows a notification to the session it was recorded for', () => {
    expect(notificationBelongsTo({ recipientCid: ALICE }, ALICE)).toBe(true);
  });

  it("hides another session's notification", () => {
    // The leak in one assertion: Bob's tab must not see Alice's message preview
    // or the name of whoever sent it.
    expect(notificationBelongsTo({ recipientCid: ALICE }, BOB)).toBe(false);
  });

  it('hides session-scoped notifications when no session is selected', () => {
    expect(notificationBelongsTo({ recipientCid: ALICE }, null)).toBe(false);
  });

  it('always shows notifications that belong to no session', () => {
    // System notices are not about anyone's conversation and must survive a
    // switch, or the scoping fix silently removes a whole category.
    expect(notificationBelongsTo({}, ALICE)).toBe(true);
    expect(notificationBelongsTo({}, null)).toBe(true);
  });
});
