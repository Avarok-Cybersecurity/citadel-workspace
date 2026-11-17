/**
 * The permission editor showed constants and saved them over reality.
 *
 * `getUserPermissions` was called and its result discarded — even on success.
 * Nothing ever wrote a response into state, so the matrix always rendered
 * `getRoleDefaultPermissions()`, and Save diffed the admin's edits against
 * those same client-side defaults rather than against what the server had. An
 * admin "reviewing" access was reading fiction, and saving pushed the defaults
 * over whatever was really being enforced: a silent reset, or a silent
 * escalation.
 *
 * Worse, the save loop ran over every ROLE and applied each role's diff to the
 * one user being edited — so an admin who changed nothing still sent writes.
 */

import { describe, it, expect, vi, beforeEach     } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getUserPermissions: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/workspace-service', () => ({
  default: { getUserPermissions: (...args: unknown[]): unknown => getUserPermissions(...args) },
}));

const { eventEmitter } = await import('@/lib/event-emitter');
const { useLoadedPermissionsAt } = await import('../use-loaded-permissions');
import type { PermissionsLoad } from '../use-loaded-permissions';

const LEVELS: readonly string[] = ['workspace-root'];
/** The answer for the one level these cases ask about. */
const useLoadedPermissions = (userId: string, domainId: string): PermissionsLoad =>
  useLoadedPermissionsAt(userId, LEVELS)[domainId] ?? { status: 'loading' };

const USER: string = 'alice';
const DOMAIN: string = 'workspace-root';

function answer(permissions: string[], userId: string = USER, domainId: string = DOMAIN): void {
  act(() => {
    eventEmitter.emit('user:permissions:loaded', {
      userId,
      domainId,
      role: 'member',
      permissions,
    });
  });
}

describe('loading a member’s permissions', () => {
  beforeEach(() => getUserPermissions.mockClear());

  it('asks the server', () => {
    renderHook(() => useLoadedPermissions(USER, DOMAIN));
    expect(getUserPermissions).toHaveBeenCalledWith(USER, DOMAIN);
  });

  it('starts as loading, not as an answer', () => {
    // The whole defect in one assertion: before this, "not loaded yet" and
    // "these are the permissions" were the same state.
    const { result } = renderHook(() => useLoadedPermissions(USER, DOMAIN));
    expect(result.current.status).toBe('loading');
  });

  it('keeps what the server actually granted', async () => {
    const { result } = renderHook(() => useLoadedPermissions(USER, DOMAIN));

    answer(['ViewContent', 'EditMdx']);

    await waitFor(() => expect(result.current.status).toBe('loaded'));
    if (result.current.status !== 'loaded') throw new Error('expected loaded');
    expect([...result.current.permissions].sort()).toEqual(['EditMdx', 'ViewContent']);
  });

  it('ignores an answer about a different member', async () => {
    const { result } = renderHook(() => useLoadedPermissions(USER, DOMAIN));

    answer(['All'], 'someone-else');

    expect(result.current.status).toBe('loading');
  });

  it('ignores an answer about a different domain', async () => {
    // One editor can be open while another domain's response arrives, and the
    // response is the only thing that says which is which.
    const { result } = renderHook(() => useLoadedPermissions(USER, DOMAIN));

    answer(['All'], USER, 'some-other-domain');

    expect(result.current.status).toBe('loading');
  });

  it('reports a send failure rather than showing defaults as fact', async () => {
    getUserPermissions.mockRejectedValueOnce(new Error('Permission denied'));

    const { result } = renderHook(() => useLoadedPermissions(USER, DOMAIN));

    await waitFor(() => expect(result.current.status).toBe('failed'));
    if (result.current.status !== 'failed') throw new Error('expected failed');
    expect(result.current.reason).toMatch(/Permission denied/);
  });
});
