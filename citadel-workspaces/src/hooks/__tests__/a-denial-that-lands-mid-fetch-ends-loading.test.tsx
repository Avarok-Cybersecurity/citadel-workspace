/**
 * A permission answer that lands while its fetch is still settling ends "loading".
 *
 * Measured live (instrumented bundle): the answer filled the provider's map -- a new
 * identity, one of the fetch effect's dependencies -- before the fetch resolved. The
 * effect re-ran, its cleanup marked the in-flight fetch cancelled, and that fetch then
 * skipped setLocalLoading(false); the re-run returned early because the domain was now
 * cached. `loading` stayed true for good, and since loading permits, a Member was offered
 * the hierarchy's "+" (answered=true, ctxHas=true, local=true).
 *
 * PermissionsContext is mocked, as in a-failed-permission-fetch-is-retried: the real
 * provider needs the WebSocket service. The mock reproduces the one ordering that matters.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePermission } from '../use-permission';
import { Permission } from '@/contexts/PermissionsContext';

const DOMAIN: string = 'workspace-root';
const state: { permissions: Map<string, { permissions: Set<Permission> }>; rerender: () => void } = {
  permissions: new Map(),
  rerender: (): void => {},
};

vi.mock('@/contexts/PermissionsContext', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    usePermissions: (): unknown => ({
      permissions: state.permissions,
      loading: false,
      hasPermission: (domainId: string, p: Permission): boolean => state.permissions.get(domainId)?.permissions.has(p) ?? false,
      getDeniedReason: (): string => 'not allowed',
      fetchPermissionsForDomain: async (domainId: string): Promise<unknown> => {
        // The answer lands first: a new map (as the real provider's sync produces) and a
        // render, before this fetch resolves.
        state.permissions = new Map(state.permissions).set(domainId, { permissions: new Set([Permission.ViewContent]) });
        act((): void => { state.rerender(); });
        await Promise.resolve();
        return { domainId };
      },
    }),
  };
});

describe('a denial that lands while its fetch settles', () => {
  it('leaves the hook answered and not loading, so the control is refused', async (): Promise<void> => {
    const { result, rerender } = renderHook(() => usePermission(DOMAIN, Permission.EditTreeStructure));
    state.rerender = rerender;
    await waitFor((): void => { expect(state.permissions.has(DOMAIN)).toBe(true); }, { timeout: 3_000 });
    await waitFor((): void => { expect(result.current.loading).toBe(false); }, { timeout: 3_000 });
    expect(result.current.allowed).toBe(false);
  });
});
