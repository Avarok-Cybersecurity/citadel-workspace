/**
 * New folder takes a NAME, and says so when given something else.
 *
 * Rename validated its input; New folder did not, so "a/b" was joined into a
 * path and refused by the tree as "Parent directory not found: /a" — an error
 * about a folder the user never asked for.
 *
 * Stubbed: the prompt (the user's answer), sonner (the output observed) and
 * mkdir (the service boundary). The handler is the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let answer: string | null = null;
vi.mock('@/components/shared/prompt-dialog', () => ({
  usePrompt: (): (() => Promise<string | null>) => async (): Promise<string | null> => answer,
}));
vi.mock('@/components/shared/confirm-dialog', () => ({ useConfirm: () => async (): Promise<boolean> => true }));
const errors: string[] = [];
vi.mock('sonner', () => ({ toast: { success: (): void => {}, error: (m: string): void => { errors.push(m); }, info: (): void => {} } }));

const { useFileManagerHandlers } = await import('../useFileManagerHandlers');
const mkdir: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<boolean> => true);

function newFolder(): (parent: string) => Promise<void> {
  const noop = (): void => {};
  return renderHook(() => useFileManagerHandlers({
    mkdir, rmdir: mkdir, removeFile: mkdir, downloadFile: async (): Promise<undefined> => undefined,
    uploadFile: mkdir, rename: mkdir, move: mkdir, copy: mkdir, refresh: async (): Promise<void> => {},
    cut: noop, copyToClipboard: noop, clearClipboard: noop, clearSelection: noop, selectAll: noop,
    currentTreeKey: null, hasPasteItems: false, clipboard: { sourceTreeKey: null, items: [] }, isCut: false,
    myCid: 1n, storageUsed: 0, storageQuota: 1, storageOffer: { kind: 'offered' }, storageMode: 'peer', selectedPeerCid: 2n,
    tree: null, currentPath: '/', filterText: '', fileInputRef: { current: null },
    chooseUploadTarget: noop, setRevfsDisabledReason: noop, setRevfsDisabledModalOpen: noop,
    setAttemptedFileSize: noop, setStorageLimitModalOpen: noop, setPropertiesNode: noop,
    storageLabel: 'Bob', downloadHistory: null, showFile: noop,
  } as unknown as Parameters<typeof useFileManagerHandlers>[0])).result.current.handleNewFolder;
}

describe('New folder', () => {
  beforeEach(() => { mkdir.mockClear(); errors.length = 0; });

  it('refuses a name with a slash, saying why, and creates nothing', async () => {
    answer = 'a/b';
    await newFolder()('/Docs');
    expect(mkdir).not.toHaveBeenCalled();
    expect(errors).toEqual(['Cannot create folder: Name cannot contain slashes']);
  });

  it('creates an ordinary name inside the folder it was asked for', async () => {
    answer = ' Drafts ';
    await newFolder()('/Docs');
    expect(mkdir).toHaveBeenCalledWith('/Docs/Drafts');
  });
});
