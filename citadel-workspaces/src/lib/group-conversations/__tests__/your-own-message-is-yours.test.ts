/**
 * A group message you sent is recognised as yours, whichever wire carried it.
 *
 * Live (owner, 2026-09-27): sending in an office/room chat raised a notification for your own
 * message. The self check compared `senderId` with the CID, but an office channel's
 * `sender_id` is the account USERNAME (the workspace server writes `actor_user_id`), so it never
 * matched -- the bell rang, and the unread badge counted your own message.
 *
 * Pure function; no mocks.
 */
import { describe, it, expect } from 'vitest';
import { isOwnGroupMessage } from '../own-message';

describe('isOwnGroupMessage', () => {
  it('matches a peer-group sender given as your CID', () => {
    expect(isOwnGroupMessage('42', { cid: 42n, username: 'thomas' })).toBe(true);
  });

  it('matches an office/room sender given as your username', () => {
    expect(isOwnGroupMessage('thomas', { cid: 42n, username: 'thomas' })).toBe(true);
  });

  it('is not yours when it is someone else, by either shape', () => {
    expect(isOwnGroupMessage('43', { cid: 42n, username: 'thomas' })).toBe(false);
    expect(isOwnGroupMessage('lara', { cid: 42n, username: 'thomas' })).toBe(false);
  });

  it('is never yours while you are not identified', () => {
    expect(isOwnGroupMessage('thomas', { cid: null, username: undefined })).toBe(false);
    expect(isOwnGroupMessage('', { cid: null, username: '' })).toBe(false);
  });
});
