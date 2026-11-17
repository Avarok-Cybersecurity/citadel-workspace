/**
 * A spec that asks "is this account still usable?" must be able to name who it
 * is looking at.
 *
 * `waitForWorkspaceLoaded` is satisfied by ANY signed-in user's workspace, so
 * `previous-sessions` — which checks a deregistration was permanent by trying
 * to log in, with two other live sessions in the same browser — could read
 * ServerAutoConnect reconnecting somebody else as "the deregistered account
 * still works".
 */
import { describe, it, expect } from 'vitest';
import { usernameFromAccountLabel } from '../signed-in-as.js';

describe('reading who is signed in from the account menu', () => {
  it('takes the username out of the label', () => {
    expect(usernameFromAccountLabel('Account menu for alice')).toBe('alice');
  });

  it('handles the administrator suffix', () => {
    expect(usernameFromAccountLabel('Account menu for alice (workspace administrator)')).toBe('alice');
  });

  it('keeps a username that itself contains brackets or spaces', () => {
    expect(usernameFromAccountLabel('Account menu for prev_sess_c_1788 (x)')).toBe('prev_sess_c_1788 (x)');
  });

  it("is null for user-service's 'Loading...' seed", () => {
    // CI read this as a username and reported "a workspace loaded, but for
    // Loading... rather than prev_sess_c_…" for every login check — a false
    // negative from the helper rather than an answer about the account.
    expect(usernameFromAccountLabel('Account menu for Loading...')).toBeNull();
  });

  it('is null for the placeholder the TopBar shows when it knows no name', () => {
    // `state.currentUser?.username || sessionFallback?.username || "User"`.
    // Treating that as an account called User would make the assertion pass for
    // a page that has no idea who is signed in.
    expect(usernameFromAccountLabel('Account menu for User')).toBeNull();
  });

  it('is null for a label that is not an account menu at all', () => {
    expect(usernameFromAccountLabel('Settings')).toBeNull();
    expect(usernameFromAccountLabel(null)).toBeNull();
  });
});
