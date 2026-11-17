/**
 * "Signed out" must be true of the agent, not just of this tab. A failed backend
 * Disconnect left the agent holding the session (sessions are removed only by
 * Disconnect or Deregister), yet the hook removed the stored session anyway and
 * the modal went on to say "Signed out". Now a failure keeps the session, says
 * which account is still signed in, and offers Retry.
 *
 * Doubled: the agent connection (connectionManager), tab storage, the WASM
 * poller, router and toaster -- all I/O boundaries. The hook's own sequencing runs for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h: {
  disconnect: ReturnType<typeof vi.fn>; removeSession: ReturnType<typeof vi.fn>; clearSelectedUser: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; answer: boolean;
} = vi.hoisted(() => ({ disconnect: vi.fn(), removeSession: vi.fn(), clearSelectedUser: vi.fn(), navigate: vi.fn(), stop: vi.fn(), answer: true }));

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getTabSelectedSession: async (): Promise<unknown> => ({ username: 'alice', serverAddress: 's:1', cid: 7n }),
    disconnect: h.disconnect, removeSession: h.removeSession,
  },
}));
vi.mock('@/lib/tab-context', () => ({ clearSelectedUser: h.clearSelectedUser, getSelectedUser: async (): Promise<unknown> => ({ selectedCid: 7n }) }));
// jsdom has no IndexedDB: the sign-out's check for edits held on the device reads the stand-in (none held).
const deviceStore: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(deviceStore));
vi.mock('@/lib/wasm-connection-manager', () => ({ wasmConnectionManager: { stop: h.stop } }));
vi.mock('react-router-dom', () => ({ useNavigate: (): unknown => h.navigate }));
vi.mock('@/components/shared/confirm-dialog', () => ({ useConfirm: (): unknown => async (): Promise<boolean> => h.answer }));
vi.mock('@/lib/leave-editor', () => ({ mayLeaveEditor: async (): Promise<boolean> => true }));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): unknown => ({ toast: vi.fn() }) }));
vi.mock('@/lib/sessions/sign-out-residue', () => ({ clearSignOutResidue: vi.fn() }));

import { useSessionExit } from '../use-session-exit';

beforeEach(() => { vi.clearAllMocks(); h.answer = true; deviceStore.clear(); });

describe('Sign Out when the agent refuses the Disconnect', () => {
  it('keeps the session, names the account, and does not say it is signed out', async () => {
    h.disconnect.mockRejectedValue(new Error('Server connection not found'));
    const { result } = renderHook(() => useSessionExit());
    await act(async () => { await result.current.handleSignOut(); });

    expect(result.current.disconnectStatus).toBe('error');
    expect(result.current.disconnectError).toMatch(/alice/);
    expect(result.current.disconnectError).toMatch(/still signed in/i);
    expect(h.removeSession).not.toHaveBeenCalled();
    expect(h.clearSelectedUser).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('signs out for real when Retry is pressed and the agent confirms', async () => {
    h.disconnect.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSessionExit());
    await act(async () => { await result.current.handleSignOut(); });
    await act(async () => { await result.current.handleRetrySignOut(); });

    expect(result.current.disconnectStatus).toBe('ready');
    expect(h.removeSession).toHaveBeenCalledWith('alice', 's:1');
  });

  it('signs out when the agent confirms at once', async () => {
    h.disconnect.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSessionExit());
    await act(async () => { await result.current.handleSignOut(); });
    expect(result.current.disconnectStatus).toBe('ready');
    expect(h.removeSession).toHaveBeenCalledTimes(1);
  });
});

describe('Sign Out with edits held on this device', () => {
  it('asks first, and leaves the account signed in when the person keeps them', async () => {
    const { documentEditsKey, localRecordPut } = await import('@/lib/document-replica-cache');
    await localRecordPut(documentEditsKey(7n, 'doc-1', 'tab-1'), [Uint8Array.from([1])]);
    h.answer = false;
    const { result } = renderHook(() => useSessionExit());
    await act(async () => { await result.current.handleSignOut(); });
    expect(h.disconnect).not.toHaveBeenCalled();
    expect(result.current.showDisconnectModal).toBe(false);
  });
});
