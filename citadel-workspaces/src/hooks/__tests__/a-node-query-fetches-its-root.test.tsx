/**
 * A permission that can never be enforced is the same defect from the other side.
 *
 * Round 392 made a refusal require the whole inheritance chain: `hasPermission`
 * denies on a domain's own entry and only then falls back to the workspace
 * root, so a node granting nothing while the root is unfetched is not yet a
 * "no". Correct — and on its own it would have made every node permission
 * unenforceable, because nothing fetched the root. `usePermission` asked for
 * its own domain and no more, so `answered` would have stayed false for ever
 * and `permits` would have returned true for everyone.
 *
 * Loosening a denial until the answer is complete is honest. Never completing
 * the answer is a control that operates on nothing, which is the failure this
 * campaign spends most of its time on.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

const fetched: string[] = [];

vi.mock('@/contexts/PermissionsContext', () => ({
  usePermissions: (): unknown => ({
    permissions: new Map(),
    loading: false,
    // The hook takes these from the CONTEXT, not the service.
    hasPermission: (): boolean => false,
    getDeniedReason: (): string => 'no',
    fetchPermissionsForDomain: async (domainId: string): Promise<unknown> => {
      fetched.push(domainId);
      return { role: null, permissions: new Set() };
    },
  }),
}));
vi.mock('@/lib/permissions-service', () => ({
  permissionsService: {
    hasPermission: (): boolean => false,
    hasAnswerFor: (): boolean => false,
    getLastFailure: (): null => null,
  },
}));

const { usePermission } = await import('../use-permission');
const { Permission } = await import('@/lib/permissions-service/types');

describe('asking about a node', () => {
  it('fetches the workspace root as well, so a refusal can ever be complete', async () => {
    fetched.length = 0;
    renderHook(() => usePermission('node-1', Permission.SendMessages));

    await waitFor((): void => {
      expect(fetched).toContain(WORKSPACE_ROOT_ID);
    });
    expect(fetched).toContain('node-1');
  });

  it('does not ask for the root twice when the root is what was asked about', async () => {
    // The positive control: fetching unconditionally would double every
    // workspace-level query, and the retry budget is spent per attempt.
    fetched.length = 0;
    renderHook(() => usePermission(WORKSPACE_ROOT_ID, Permission.SendMessages));

    await waitFor((): void => {
      expect(fetched.length).toBeGreaterThan(0);
    });
    expect(fetched.filter((d) => d === WORKSPACE_ROOT_ID)).toHaveLength(1);
  });
});
