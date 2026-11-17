import { describe, it, expect } from 'vitest';
import { isForThisSession } from '@/lib/sessions/notification-ownership';

describe('isForThisSession', () => {
  it('accepts a notification addressed to this tab’s session', () => {
    expect(isForThisSession(42n, 42n)).toBe(true);
  });

  /** The defect: a notification for another account landing in this tab. */
  it('refuses a notification addressed to a different session', () => {
    expect(isForThisSession(42n, 7n)).toBe(false);
  });

  /**
   * The leader tab is very often the landing/connect page, which has no cid.
   * Treating "I am nobody" as "everything is mine" is how a tab logged into no
   * account came to process another account's messages.
   */
  it('refuses when this tab has no session', () => {
    expect(isForThisSession(42n, null)).toBe(false);
    expect(isForThisSession(42n, undefined)).toBe(false);
  });

  it('refuses when the notification names no session', () => {
    expect(isForThisSession(null, 42n)).toBe(false);
    expect(isForThisSession(undefined, 42n)).toBe(false);
  });

  /**
   * Zero is the "no session" sentinel elsewhere in this codebase. Two unknowns
   * are not a match — without this, a notification with cid 0 delivered to a
   * tab whose cid is still 0 would pass.
   */
  it('refuses the zero sentinel, even against itself', () => {
    expect(isForThisSession(0n, 0n)).toBe(false);
    expect(isForThisSession(0n, 42n)).toBe(false);
    expect(isForThisSession(42n, 0n)).toBe(false);
  });
});
