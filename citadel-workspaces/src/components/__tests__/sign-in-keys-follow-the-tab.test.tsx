/**
 * Settings -> Privacy -> Sign-in keys appears in a tab that resumed its session.
 *
 * The section read its account from `connectionManager.getConnectionInfo()`,
 * which has no username or cid in a tab that resumed rather than signed in, so
 * `account` was null and the whole section returned nothing. The rest of the
 * app asks the tab's own selection first.
 *
 * Mocked: the tab selection and saved-session reads are IndexedDB I/O, and
 * the sign-in deps' agent and authenticator (the socket and navigator.credentials)
 * are the fakes every sign-in test uses.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: (): Promise<{ selectedUsername: string; selectedCid: bigint; selectedServerAddress: string }> =>
    Promise.resolve({ selectedUsername: 'alice0924', selectedCid: 7n, selectedServerAddress: 'bench.work.avarok.net' }),
}));
const h: { w: World } = vi.hoisted(() => ({ w: undefined as unknown as World }));
vi.mock('@/lib/sign-in', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  browserSignInDeps: (): World['deps'] => h.w.deps,
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    // A resumed tab: the connection knows nothing about who this is.
    getConnectionInfo: (): null => null,
    getTabSelectedSession: (): Promise<null> => Promise.resolve(null),
  },
}));

import { useSignInKeys } from '../passkey/useSignInKeys';
import { world, type World } from '@/lib/sign-in/__tests__/helpers';

describe('sign-in keys in a resumed tab', () => {
  it('knows the account from the tab selection', async () => {
    h.w = world(false);
    h.w.agent.account('alice0924');
    const { result } = renderHook(() => useSignInKeys(async (): Promise<'cancelled'> => 'cancelled'));
    await waitFor(() => expect(result.current.account).toEqual({ username: 'alice0924', cid: 7n, tenant: 'bench.work.avarok.net' }));
  });
});
