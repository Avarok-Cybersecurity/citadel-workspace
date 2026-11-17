/**
 * A permissions change arrives as a ROLE notification, on purpose.
 *
 * The server's `UpdateMemberPermissions` handler says why: "`Success` carries no
 * user id, so the broadcast is the role-shaped notification with the member's
 * CURRENT role — what the client needs is 'your permissions moved, drop your
 * cache', and the role is how it identifies whose."
 *
 * Beside the listener that does that sat one for `member:permissions-updated`,
 * which nothing emits and nothing was going to, because the design chose the
 * other carrier. Its entry in the dead-listener list read "no producer —
 * permission changes are read back via GetUserPermissions", which is not what
 * happens. An inaccurate reason in a debt list is worse than no entry: it is
 * what stops the next reader from checking.
 *
 * It also read as THE permissions-refresh path, so the obvious repair was to
 * start emitting it — which would have refreshed twice for one change. Deleted,
 * and this holds the surviving path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { Permission } from '../types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

const currentUser: { id: string } = { id: 'alice' };

// Both, because the service reads the synchronous one first and falls back to
// the async one -- and the sync accessor is null for a user who logged IN
// rather than registering, which the service's own comment records as having
// left the cache permanently empty.
vi.mock('../current-user', () => ({
  currentUserIdSync: (): string => currentUser.id,
  resolveCurrentUserId: async (): Promise<string> => currentUser.id,
}));

const { PermissionsService } = await import('../service');
const permissionsService: ReturnType<typeof PermissionsService.getInstance> =
  PermissionsService.getInstance();

/**
 * Fill the cache the way a real load does.
 *
 * The workspace root too, because `hasAnswerFor` is about the inheritance
 * chain: a node entry with no root behind it is not a complete answer, since
 * the root is where an inherited grant would come from.
 */
function loadPermissionsFor(userId: string): void {
  for (const domainId of ['node-1', WORKSPACE_ROOT_ID]) {
    eventEmitter.emit('user:permissions:loaded', {
      userId,
      domainId,
      role: 'Member',
      permissions: [Permission.SendMessages],
    });
  }
}

describe('a permissions change', () => {
  beforeEach((): void => {
    currentUser.id = 'alice';
    // The constructor registers the listeners; getInstance() above has already
    // run it. Only the cache needs resetting between tests.
    permissionsService.clearCache();
  });

  it('drops the cache when the notification is about you', async () => {
    loadPermissionsFor('alice');
    await new Promise((resolve): void => { setTimeout(resolve, 0); });
    expect(permissionsService.hasAnswerFor('node-1')).toBe(true);

    eventEmitter.emit('member:role-updated', { userId: 'alice', role: 'Admin' });
    await new Promise((resolve): void => { setTimeout(resolve, 0); });

    // Gone, so the next read asks again rather than answering from the rights
    // this user had a moment ago.
    expect(permissionsService.hasAnswerFor('node-1')).toBe(false);
  });

  it('leaves it alone when the notification is about somebody else', async () => {
    // The positive control: a service that cleared on every notification would
    // pass the test above and refetch the whole app's permissions every time
    // any member anywhere changed role.
    loadPermissionsFor('alice');
    await new Promise((resolve): void => { setTimeout(resolve, 0); });
    expect(permissionsService.hasAnswerFor('node-1')).toBe(true);

    eventEmitter.emit('member:role-updated', { userId: 'bob', role: 'Admin' });
    await new Promise((resolve): void => { setTimeout(resolve, 0); });

    expect(permissionsService.hasAnswerFor('node-1')).toBe(true);
  });
});
