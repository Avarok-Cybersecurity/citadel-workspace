/**
 * The uploader sees an upload at once, counted in "used", and marked as
 * pending until the peer confirms it.
 *
 * Live: "Not confirmed by the peer yet — Uploaded: revfs-0925.bin on this
 * device", while the listing still showed only Received Files / Sent Files and
 * "0 B / 100 MB used", then and after a reload.
 *
 * The real file-manager composition (useFileManagerContent → useRevfsTree →
 * the engine singleton → RevfsIO → the OPFS adapter on an in-memory OPFS).
 * Stubbed: which account and peers this tab has, the dialogs, sonner, and the
 * transport, which fails as a peer with no open channel does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RevfsOpfsStorage } from '@/lib/revfs/opfs-storage';
import { startRevfs, forgetRevfsLoad } from '@/lib/revfs/revfs-loader';
import { revfsService } from '@/lib/revfs';
import { installFakeOpfs } from '@/lib/revfs/__tests__/fake-opfs';
import { resetTreeReadTracking } from '@/lib/revfs/persist-tree';
import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { UseFileManagerContentResult } from '../useFileManagerContent';
import { fileTransferService } from '@/lib/file-transfer';
import { useFileManagerContent } from '../useFileManagerContent';

const peers: { registeredPeers: { cid: string; username: string; displayName: string }[]; isLoading: boolean } = {
  registeredPeers: [{ cid: '200', username: 'bob', displayName: 'Bob Brown' }], isLoading: false,
};
vi.mock('@/hooks/use-registered-peers', () => ({ useRegisteredPeers: (): typeof peers => peers }));
vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 300n }));
vi.mock('@/components/shared/prompt-dialog', () => ({ usePrompt: () => async (): Promise<null> => null }));
vi.mock('@/components/shared/confirm-dialog', () => ({ useConfirm: () => async (): Promise<boolean> => true }));
const toasts: string[] = [];
vi.mock('sonner', () => ({
  toast: new Proxy({}, { get: (_t: object, kind: string | symbol) => (m: string): number => { toasts.push(`${String(kind)}: ${m}`); return 1; } }),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetTreeReadTracking(); toasts.length = 0; });

async function fileManager(treeEvents: boolean): Promise<{ current: UseFileManagerContentResult }> {
  forgetRevfsLoad();
  // The engine is a module singleton: without this, the second test starts
  // from the first one's cached tree, upload included, and proves nothing.
  const state: { trees: Map<string, unknown>; pendingOps: Map<string, unknown> } =
    (revfsService as unknown as { state: { trees: Map<string, unknown>; pendingOps: Map<string, unknown> } }).state;
  state.trees.clear();
  state.pendingOps.clear();
  await startRevfs({
    sendP2PMessageReliable: async (): Promise<void> => { throw new Error('no P2P channel'); },
    getCurrentCid: async (): Promise<bigint> => 300n,
    sendInternalServiceRequest: async (): Promise<void> => {},
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  });
  const root: ReturnType<typeof installFakeOpfs> = installFakeOpfs();
  const io: { storage: RevfsOpfsStorage; execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } =
    (revfsService as unknown as { io: { storage: RevfsOpfsStorage; execute: (i: RevfsIntent) => Promise<RevfsIntentResult> } }).io;
  (io.storage as unknown as { getRootDir: () => Promise<unknown> }).getRootDir = (): Promise<unknown> => root.getDirectoryHandle('revfs', { create: true });
  const real: (i: RevfsIntent) => Promise<RevfsIntentResult> = io.execute.bind(io);
  io.execute = async (i: RevfsIntent): Promise<RevfsIntentResult> =>
    i.type === 'backend-send-file' ? { type: 'backend-send-file', success: true } : real(i);
  vi.spyOn(fileTransferService, 'getSettings').mockReturnValue({
    autoAccept: false, autoAcceptAnswered: false, maxFileSize: 1e9, allowRevfsStorage: true, revfsQuota: 100e6,
  });
  if (!treeEvents) vi.spyOn(revfsService, 'onTreeChanged').mockReturnValue((): void => {});
  // Bob's storage, by address: the file manager no longer picks a peer itself.
  const { result } = renderHook((): UseFileManagerContentResult => useFileManagerContent(), {
    wrapper: ({ children }: { children: ReactNode }): JSX.Element => <MemoryRouter initialEntries={['/workspace?section=files&peer_id=200']}>{children}</MemoryRouter>,
  });
  await waitFor(() => expect(result.current.tree).not.toBeNull(), { timeout: 5000 });
  return result;
}

async function upload(fm: { current: UseFileManagerContentResult }): Promise<void> {
  const file: File = Object.assign(new File([new Uint8Array(4900)], 'revfs-0925.bin'), {
    arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(4900),
  });
  const list: FileList = { 0: file, length: 1, item: (): File => file, [Symbol.iterator]: function* (): Generator<File> { yield file; } } as unknown as FileList;
  await act(async (): Promise<void> => { await fm.current.handleDrop(fm.current.takeUploadTarget(), list); });
}

function names(fm: { current: UseFileManagerContentResult }): string[] {
  return (fm.current.tree?.children ?? []).map((c) => c.name);
}

describe('an upload the peer has not confirmed', () => {
  it('is listed, counted, and marked pending', async () => {
    const fm: { current: UseFileManagerContentResult } = await fileManager(true);
    await upload(fm);
    // The progress toast (loading, then dismissed) is not an outcome; the one outcome is the refusal.
    expect(toasts.filter((t: string) => !/^(loading|dismiss):/.test(t))).toEqual([expect.stringMatching(/^error: Not confirmed by the peer yet/)]);
    expect(toasts.some((t: string) => t.startsWith('loading: Uploading'))).toBe(true);
    expect(names(fm)).toContain('revfs-0925.bin');
    expect(fm.current.storageUsed).toBe(4900);
    expect(fm.current.pendingPaths.has('/revfs-0925.bin')).toBe(true);
  }, 20_000);

  it('is listed even when no tree-changed event reaches the view', async () => {
    const fm: { current: UseFileManagerContentResult } = await fileManager(false);
    await upload(fm);
    expect(names(fm)).toContain('revfs-0925.bin');
    expect(fm.current.storageUsed).toBe(4900);
  }, 20_000);
});
