/**
 * Setting a profile photo must survive the next workspace event.
 *
 * Reported: "When I update my profile photo, I don't see the update reflect on
 * the top right corner avatar."
 *
 * `TopBar` renders `state.currentUser?.avatarUrl`. The only writer of that
 * field is the `user:profile-updated` handler in `useEventEmitterSetup`. The
 * workspace-loaded handler in `useWorkspaceEventSetup` then built a REPLACEMENT
 * `currentUser` out of `UserRegistrationInfo`, which has no avatar in it at all
 * — username, fullName, serverAddress, serverPassword — so the field was
 * dropped every time a workspace loaded.
 *
 * The assertion below is on the merge, not on a rendered `<img>`: the defect is
 * that a partial record was assigned over a fuller one, and testing the
 * function that does the folding is what makes it impossible to reintroduce by
 * adding a field to one side and forgetting the other.
 */
import { describe, it, expect } from 'vitest';
import { mergeCurrentUser, type CurrentUser, type SessionIdentity } from '../merge-current-user';

const SESSION: SessionIdentity = { username: 'ada', fullName: 'Ada Lovelace', role: 'admin' };

describe('folding a session into currentUser', () => {
  it('keeps an avatar the session knows nothing about', () => {
    const withPhoto: CurrentUser = {
      id: 'ada',
      username: 'ada',
      name: 'Ada Lovelace',
      avatarUrl: 'data:image/webp;base64,AAAA',
    };

    const merged: CurrentUser = mergeCurrentUser(withPhoto, SESSION);

    expect(merged.avatarUrl).toBe('data:image/webp;base64,AAAA');
  });

  it('still takes the session as the source of identity', () => {
    // The discrimination control. A merge that simply returned `previous`
    // would satisfy the assertion above while breaking a rename, so the
    // session's own fields must still win.
    const stale: CurrentUser = { id: 'old', username: 'old', name: 'Old Name', role: 'member' };

    const merged: CurrentUser = mergeCurrentUser(stale, SESSION);

    expect(merged.id).toBe('ada');
    expect(merged.username).toBe('ada');
    expect(merged.name).toBe('Ada Lovelace');
    expect(merged.role).toBe('admin');
  });

  it('works when there is nothing to merge into', () => {
    const merged: CurrentUser = mergeCurrentUser(undefined, { username: 'grace' });

    expect(merged).toEqual({ id: 'grace', username: 'grace', name: 'grace', role: undefined });
  });

  it('keeps a known role when the session has not loaded one', () => {
    // A reconnect can arrive before the stored session carries a role. Blanking
    // it would flip an admin's UI to a member's for as long as that takes.
    const known: CurrentUser = { id: 'ada', username: 'ada', name: 'Ada', role: 'admin' };

    const merged: CurrentUser = mergeCurrentUser(known, { username: 'ada', fullName: 'Ada' });

    expect(merged.role).toBe('admin');
  });
});
