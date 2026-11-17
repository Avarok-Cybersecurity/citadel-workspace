/**
 * The username is in the selection; only the full name needs the saved account.
 *
 * `getTabSelectedSession` reads the tab selection and then looks it up in the
 * saved accounts, returning null when there is no record. Stored sessions hold
 * saved credentials, so a user who declined to save them — or whose store has
 * not loaded yet — has a perfectly good selection and nothing for it to find.
 *
 * `BaseOffice` went straight to the session and fell through to `'unknown'` for
 * the id `OfficeChatTabs` uses to decide which messages are the reader's own:
 * no own-message styling, no edit, no delete, on their own messages.
 */
import { describe, it, expect } from 'vitest';
import { tabIdentity, readerIdentity } from '../tab-identity';
import type { StoredSession } from '@/types/session-types';

const SESSION: StoredSession = {
  username: 'alice',
  fullName: 'Alice Chen',
  serverAddress: 'x:1',
} as StoredSession;

describe('who this tab is', () => {
  it('names the user from the selection when there is no saved account', () => {
    expect(tabIdentity({ selectedUsername: 'alice' }, null)).toEqual({
      username: 'alice',
      fullName: undefined,
    });
  });

  it('prefers the selection over the saved account', () => {
    // They can disagree: the selection is what this tab switched to, the saved
    // account is whatever was found for it.
    expect(tabIdentity({ selectedUsername: 'bob' }, SESSION).username).toBe('bob');
  });

  it('still takes the full name from the saved account, which is the only place it lives', () => {
    // The positive control. Ignoring the session entirely would satisfy the
    // tests above and lose the display name everywhere it is shown.
    expect(tabIdentity({ selectedUsername: 'alice' }, SESSION).fullName).toBe('Alice Chen');
  });

  it('falls back to the saved account when there is no selection', () => {
    expect(tabIdentity(null, SESSION).username).toBe('alice');
  });

  it('knows nothing when neither does', () => {
    expect(tabIdentity(null, null)).toEqual({ username: undefined, fullName: undefined });
  });
});

describe('who the reader is, in a room', () => {
  it('does not fall through to "unknown" when the tab knows the user', () => {
    // `id` decides which chat messages are the reader's own -- own-message
    // styling, edit and delete all hang off it -- so 'unknown' takes those away
    // from somebody looking at their own messages.
    expect(readerIdentity(null, { username: 'alice' }).id).toBe('alice');
  });

  it('prefers the workspace state, which is the fuller record', () => {
    // The positive control for the order: the tab identity is the fallback for
    // the first render, not the answer.
    expect(readerIdentity({ id: 'bob', displayName: 'Bob' }, { username: 'alice' }).id).toBe('bob');
  });

  it('is "unknown" only when nothing at all knows', () => {
    expect(readerIdentity(null, null).id).toBe('unknown');
    expect(readerIdentity(null, null).displayName).toBe('Unknown User');
  });
});
