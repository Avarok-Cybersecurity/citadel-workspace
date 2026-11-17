/**
 * Deleting asks first, and a refusal deletes nothing.
 *
 * Both destructive file-manager paths sit behind `confirm({...})`, and neither
 * is exercised by any spec -- `handleDeleteMultiple` is reached by no
 * integration test at all. That matters more than it sounds: round 417 found a
 * deregistration that silently did nothing for weeks because the spec never
 * answered its second dialog, while three checks reported success. A guard
 * nothing tests is a guard nobody knows the state of.
 *
 * These are unit tests because the hook takes its dependencies as parameters:
 * `rmdir`, `removeFile` and `confirm` are all injectable, so the real handler
 * runs and only the boundary is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RevfsNode } from '@/types/revfs-types';
import { useFileManagerHandlers } from '../useFileManagerHandlers';

let answer: boolean = true;
vi.mock('@/components/shared/confirm-dialog', () => ({
  useConfirm: (): (() => Promise<boolean>) => async (): Promise<boolean> => answer,
}));
const toasts: { success: string[]; error: string[] } = { success: [], error: [] };
vi.mock('sonner', () => ({
  toast: {
    success: (m: string): void => { toasts.success.push(m); },
    error: (m: string): void => { toasts.error.push(m); },
  },
}));
// The hook also asks for a prompt (rename). Stubbed at the same boundary as
// `confirm`, so the handler under test is the real one.
vi.mock('@/components/shared/prompt-dialog', () => ({
  usePrompt: (): (() => Promise<string | null>) => async (): Promise<string | null> => null,
}));

// The peer's answer, which these operations now report. An `async () => {}`
// here resolves undefined, which reads as "the peer did not acknowledge" -- so
// the stub has to state which peer it is modelling.
let peerAcknowledges: boolean = true;
const rmdir: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<boolean> => peerAcknowledges);
const removeFile: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<boolean> => peerAcknowledges);

function node(path: string, type: 'directory' | 'file'): RevfsNode {
  return { path, name: path.split('/').pop() ?? path, type, children: [] } as unknown as RevfsNode;
}

async function handlers(): Promise<ReturnType<typeof useFileManagerHandlers>> {
  const noop: () => void = (): void => {};
  const anoop: () => Promise<void> = async (): Promise<void> => {};
  const adone: () => Promise<boolean> = async (): Promise<boolean> => true;
  return renderHook(() =>
    useFileManagerHandlers({
      mkdir: adone, rmdir, removeFile,
      downloadFile: async (): Promise<string | undefined> => undefined,
      uploadFile: adone, rename: adone, move: adone, copy: adone, refresh: anoop,
      cut: noop, copyToClipboard: noop, clearClipboard: noop, clearSelection: noop, selectAll: noop,
      currentTreeKey: null, hasPasteItems: false, clipboard: null, isCut: false,
      myCid: 1n, storageUsed: 0, storageQuota: 1000, storageOffer: { kind: 'offered' },
      storageMode: 'peer', selectedPeerCid: 2n,
      tree: null, currentPath: '/', filterText: '',
      fileInputRef: { current: null },
      chooseUploadTarget: noop, setRevfsDisabledReason: noop,
      setRevfsDisabledModalOpen: noop, setAttemptedFileSize: noop,
      setStorageLimitModalOpen: noop, setPropertiesNode: noop,
    } as unknown as Parameters<typeof useFileManagerHandlers>[0]),
  ).result.current;
}

describe('deleting one item', () => {
  beforeEach(() => {
    rmdir.mockClear(); removeFile.mockClear(); answer = true; peerAcknowledges = true;
    toasts.success.length = 0; toasts.error.length = 0;
  });

  it('deletes nothing when the question is refused', async () => {
    answer = false;
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDelete(node('/notes', 'directory'));
    await h.handleDelete(node('/a.txt', 'file'));
    expect(rmdir).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('says so when it lands, because the silence is otherwise eight seconds long', async () => {
    // Deleting a SELECTION already toasts on success; deleting one item
    // announced only failures. A run measured 7.8s between the confirm click
    // and `rmdir` even starting -- it queues behind the previous step's peer
    // ack -- so a success that says nothing reads as a click that missed.
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDelete(node('/notes', 'directory'));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(toasts.success).toEqual(['Deleted notes']);
    expect(toasts.error).toEqual([]);
  });

  it('does not claim a deletion the peer never acknowledged', async () => {
    // The local tree HAS changed and is persisted, and the operation is queued
    // for retry -- so this is not "Failed to delete". It is also not "Deleted",
    // which is what every peer operation used to say regardless, because the
    // ack flag stopped at `sendAndAwaitAck` and no layer above returned it.
    peerAcknowledges = false;
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDelete(node('/notes', 'directory'));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(toasts.success).toEqual([]);
    expect(toasts.error).toEqual(['Not confirmed by the peer yet']);
  });

  it('routes a folder to rmdir and a file to removeFile', async () => {
    // Positive control: the guard must not block an accepted deletion, and the
    // two kinds must not be swapped.
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDelete(node('/notes', 'directory'));
    await h.handleDelete(node('/a.txt', 'file'));
    expect(rmdir).toHaveBeenCalledWith('/notes');
    expect(removeFile).toHaveBeenCalledWith('/a.txt');
  });
});

describe('deleting a selection', () => {
  beforeEach(() => { rmdir.mockClear(); removeFile.mockClear(); answer = true; });

  it('deletes nothing when the question is refused', async () => {
    answer = false;
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDeleteMultiple([node('/notes', 'directory'), node('/a.txt', 'file')]);
    expect(rmdir).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('routes each item by its own kind', async () => {
    const h: Awaited<ReturnType<typeof handlers>> = await handlers();
    await h.handleDeleteMultiple([node('/notes', 'directory'), node('/a.txt', 'file')]);
    expect(rmdir).toHaveBeenCalledWith('/notes');
    expect(removeFile).toHaveBeenCalledWith('/a.txt');
  });
});
