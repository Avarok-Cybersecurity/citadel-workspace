/**
 * The role table every picker reads: loading until answered (never an empty table), replaced by
 * every RoleChanged -- this tab's own edit's answer or the server's broadcast of another's --
 * and forgotten on a session change. The list request is a plain function, so no mock is needed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RolesResponse, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { getRolesState, reloadRoles, requestRoles, resetRoles, subscribeRoles, type RolesState } from '../roles-store';
import { GUEST, MEMBER, SEED, tableOf, OWNER, ADMIN } from '@/test-utils/role-table';

interface Deferred { promise: Promise<WorkspaceRoles>; resolve: (table: WorkspaceRoles) => void; reject: (error: Error) => void }
function deferred(): Deferred {
  let resolve: (table: WorkspaceRoles) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<WorkspaceRoles> = new Promise<WorkspaceRoles>((res: (t: WorkspaceRoles) => void, rej: (e: Error) => void): void => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = (): Promise<void> => new Promise<void>((done: () => void): void => { setTimeout(done, 0); });
const broadcast = (answer: RolesResponse): void => { eventEmitter.emit('workspace:roles', { answer }); };
const RENAMED: WorkspaceRoles = tableOf(OWNER, ADMIN, { ...MEMBER, name: 'Crew' }, GUEST);

afterEach((): void => { resetRoles(); });

describe('the role table store', () => {
  it('is loading, not empty, while the list is in flight, then holds the answer', async () => {
    const answer: Deferred = deferred();
    requestRoles(() => answer.promise);
    expect(getRolesState()).toEqual({ status: 'loading' });
    answer.resolve(SEED);
    await settle();
    expect(getRolesState()).toEqual({ status: 'loaded', table: SEED });
  });

  it('asks once: a second request while one is out, or after it arrived, sends nothing', async () => {
    let asked: number = 0;
    const list = (): Promise<WorkspaceRoles> => { asked += 1; return Promise.resolve(SEED); };
    requestRoles(list);
    requestRoles(list);
    await settle();
    requestRoles(list);
    expect(asked).toBe(1);
  });

  it('replaces the table on a RoleChanged, and tells its subscribers', async () => {
    requestRoles(() => Promise.resolve(SEED));
    await settle();
    const seen: RolesState[] = [];
    const off: () => void = subscribeRoles((): void => { seen.push(getRolesState()); });
    broadcast({ RoleChanged: { role_id: 'member', roles: RENAMED } });
    off();
    expect(getRolesState()).toEqual({ status: 'loaded', table: RENAMED });
    expect(seen).toEqual([{ status: 'loaded', table: RENAMED }]);
  });

  it('keeps the failure, in the server\'s words, when the list is refused', async () => {
    requestRoles(() => Promise.reject(new Error('Permission denied: ViewContent required')));
    await settle();
    expect(getRolesState()).toEqual({ status: 'failed', reason: 'Permission denied: ViewContent required' });
  });

  it('does not let a failed list undo a table that arrived another way', async () => {
    const answer: Deferred = deferred();
    requestRoles(() => answer.promise);
    broadcast({ Roles: SEED });
    answer.reject(new Error('No active connection available. Please connect first.'));
    await settle();
    expect(getRolesState()).toEqual({ status: 'loaded', table: SEED });
  });

  it('forgets the table on a session change, and drops the previous session\'s late answer', async () => {
    const answer: Deferred = deferred();
    requestRoles(() => answer.promise);
    eventEmitter.emit('instance:cid-changed', { cid: 2n });
    answer.resolve(SEED);
    await settle();
    expect(getRolesState()).toEqual({ status: 'unknown' });
  });
});

describe('reading the table again', () => {
  const unheard = (reason: string): void => { throw new Error(`reported stale: ${reason}`); };

  it('replaces a table already held, without passing back through loading', async () => {
    requestRoles(() => Promise.resolve(SEED));
    await settle();
    const seen: RolesState[] = [];
    const off: () => void = subscribeRoles((): void => { seen.push(getRolesState()); });
    await reloadRoles(() => Promise.resolve(RENAMED), unheard);
    off();
    expect(seen).toEqual([{ status: 'loaded', table: RENAMED }]);
  });

  it('keeps the table it had when the read is refused, and reports the refusal', async () => {
    requestRoles(() => Promise.resolve(SEED));
    await settle();
    const reported: string[] = [];
    await reloadRoles(() => Promise.reject(new Error('Rate limit exceeded')), (reason: string): void => { reported.push(reason); });
    expect(getRolesState()).toEqual({ status: 'loaded', table: SEED });
    expect(reported).toEqual(['Rate limit exceeded']);
  });

  it('keeps a refusal as one when there was no table to show', async () => {
    await reloadRoles(() => Promise.reject(new Error('Permission denied: ViewContent required')), unheard);
    expect(getRolesState()).toEqual({ status: 'failed', reason: 'Permission denied: ViewContent required' });
  });

  it('drops the previous session\'s answer', async () => {
    const answer: Deferred = deferred();
    const reloading: Promise<void> = reloadRoles(() => answer.promise, unheard);
    eventEmitter.emit('instance:cid-changed', { cid: 3n });
    answer.resolve(SEED);
    await reloading;
    expect(getRolesState()).toEqual({ status: 'unknown' });
  });
});
