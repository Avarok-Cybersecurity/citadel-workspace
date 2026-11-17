/**
 * A privacy choice made in one tab must reach the others.
 *
 * `getPrivacySettings` memoises — the send paths consult it per keystroke for
 * typing indicators and per message for read receipts, so a synchronous
 * localStorage read each time would be a needless main-thread hit. The cache's
 * own comment says it is "invalidated by every write, including writes from
 * another tab".
 *
 * Half of that was true. The writing tab clears its own cache in
 * `savePrivacySettings`; the `storage` listener that clears every other tab's
 * lived in `initPrivacySettingsSync`, which nothing called. So turning off
 * "Send read receipts" in one tab left every other tab sending them until it
 * was reloaded — the switch reads off, and the promise is broken in the tab the
 * user is not looking at.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPrivacySettings,
  savePrivacySettings,
  initPrivacySettingsSync,
  DEFAULT_PRIVACY_SETTINGS,
} from '../privacy-settings';

const STORAGE_KEY: string = 'citadel:privacy-settings';

describe('privacy settings across tabs', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('picks up a change another tab wrote', () => {
    stop = initPrivacySettingsSync();
    expect(getPrivacySettings().sendReadReceipts).toBe(true);

    // What another tab's write looks like from here: localStorage already
    // holds the new value, and a `storage` event announces it. The event does
    // NOT fire in the tab that wrote, which is why the writer clears its own
    // cache directly and this path exists for everyone else.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts: false }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(getPrivacySettings().sendReadReceipts).toBe(false);
  });

  it('ignores a write to some other key', () => {
    // Without this the rule would pass by invalidating on everything, which is
    // indistinguishable from not caching at all.
    stop = initPrivacySettingsSync();
    getPrivacySettings();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts: false }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'something:else' }));

    expect(getPrivacySettings().sendReadReceipts).toBe(true);
  });

  it('stops listening when torn down', () => {
    const release: () => void = initPrivacySettingsSync();
    getPrivacySettings();
    release();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts: false }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(getPrivacySettings().sendReadReceipts).toBe(true);
  });
});
