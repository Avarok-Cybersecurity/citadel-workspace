/**
 * The file manager opens the storage the address names, and no other.
 *
 * It picked `registeredPeers[0]` whenever nothing was chosen, so the sidebar's
 * File Manager opened on whichever member sorted first ("Alexander Derkatsch
 * Storage"). Now the address says whose storage it is; the sidebar sends the
 * server, and a peer link opens that peer -- or says it cannot.
 *
 * Mocked: `useRegisteredPeers` and `getCurrentCid` query the agent, and the two
 * tree hooks open RE-VFS sessions. What is under test is which sources the file
 * manager reads and what it decides from them.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TreeScope } from '@/types/revfs-types';
import { fileManagerScreen, type FileManagerScreenInputs } from '../file-manager-screen';

const noTree: Record<string, unknown> = vi.hoisted((): Record<string, unknown> => {
  const ok = (): Promise<boolean> => Promise.resolve(true);
  return {
    tree: null, loading: true, error: null, storageUsed: 0, storageQuota: 0, storageOffer: { kind: 'offered' },
    mkdir: ok, rmdir: ok, uploadFile: ok, downloadFile: (): Promise<undefined> => Promise.resolve(undefined),
    removeFile: ok, rename: ok, move: ok, copy: ok, refresh: (): Promise<void> => Promise.resolve(), pendingPaths: new Set<string>(),
  };
});

vi.mock('@/hooks/use-registered-peers', () => ({
  useRegisteredPeers: (): Record<string, unknown> => ({
    registeredPeers: [
      { cid: '42', username: 'alexander', displayName: 'Alexander Derkatsch', isOnline: true, isConnected: true, connectionPath: null },
      { cid: '43', username: 'bob', displayName: 'Bob Stone', isOnline: true, isConnected: false, connectionPath: null },
    ],
    isLoading: false,
    refreshPeers: (): Promise<void> => Promise.resolve(),
  }),
}));
vi.mock('@/lib/p2p/current-cid', () => ({
  getCurrentCid: (): Promise<bigint> => Promise.resolve(7n),
}));
vi.mock('@/hooks/useRevfsTree', () => ({
  useRevfsTree: (): Record<string, unknown> => noTree,
  useServerRevfsTree: (): Record<string, unknown> => noTree,
}));

import { useFileManagerContent, type UseFileManagerContentResult } from '../useFileManagerContent';
import { PromptDialogProvider } from '@/components/shared/prompt-dialog';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';

function openAt(route: string): { current: UseFileManagerContentResult } {
  const { result } = renderHook(() => useFileManagerContent(), {
    wrapper: ({ children }: { children: ReactNode }): JSX.Element => (
      <MemoryRouter initialEntries={[route]}>
        <ConfirmDialogProvider><PromptDialogProvider>{children}</PromptDialogProvider></ConfirmDialogProvider>
      </MemoryRouter>
    ),
  });
  return result;
}

describe('the file manager', () => {
  it('opens the server, not the first registered peer, when the address names neither', async () => {
    const result: { current: UseFileManagerContentResult } = openAt('/workspace?section=files');
    await waitFor(() => expect(result.current.myCid).toBe(7n));
    expect(result.current.storageMode).toBe(TreeScope.Server);
    expect(result.current.selectedPeerCid).toBeNull();
    expect(result.current.currentPath).toBe('/');
  });

  it('opens the peer and the folder a link names', async () => {
    const result: { current: UseFileManagerContentResult } = openAt('/workspace?section=files&peer_id=43&path=/Docs');
    await waitFor(() => expect(result.current.selectedPeerCid).toBe(43n));
    expect(result.current.storageMode).toBe(TreeScope.Peer);
    expect(result.current.currentPath).toBe('/Docs');
    expect(result.current.storageName).toBe('Shared with Bob Stone');
  });

  it('keeps the connection state of each peer, for the status strip', async () => {
    const result: { current: UseFileManagerContentResult } = openAt('/workspace?section=files');
    await waitFor(() => expect(result.current.myCid).toBe(7n));
    expect(result.current.registeredPeers.map((p) => [p.cid, p.isConnected])).toEqual([[42n, true], [43n, false]]);
  });

  it('opens no peer for a CID that is not registered', async () => {
    const result: { current: UseFileManagerContentResult } = openAt('/workspace?section=files&peer_id=99');
    await waitFor(() => expect(result.current.myCid).toBe(7n));
    expect(result.current.peerRegistered).toBe(false);
    expect(result.current.selectedPeerCid).toBeNull();
  });
});

describe('which screen it shows', () => {
  const base: FileManagerScreenInputs = {
    myCid: 7n, storage: { kind: 'peer', cid: 42n }, peersLoading: false, peerRegistered: true,
    treeLoading: false, hasError: false, hasTree: true,
  };

  it('does not call a peer unknown while the list is still loading', () => {
    expect(fileManagerScreen({ ...base, peerRegistered: false, peersLoading: true })).toBe('finding-peers');
  });

  it('calls a peer unknown once the loaded list does not have them', () => {
    expect(fileManagerScreen({ ...base, peerRegistered: false })).toBe('unknown-peer');
  });

  it('calls an unreadable id unknown, never the server', () => {
    expect(fileManagerScreen({ ...base, storage: { kind: 'invalid', raw: 'bob' } })).toBe('unknown-peer');
  });

  it('does not open "your storage with yourself"', () => {
    expect(fileManagerScreen({ ...base, storage: { kind: 'peer', cid: 7n } })).toBe('unknown-peer');
  });

  it('needs no peer for server storage', () => {
    expect(fileManagerScreen({ ...base, storage: { kind: 'server' }, peerRegistered: false })).toBe('browser');
  });
});
