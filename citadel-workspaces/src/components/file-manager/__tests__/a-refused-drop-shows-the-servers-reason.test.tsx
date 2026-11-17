/**
 * The dialog a drop on refused storage opens says the refused offer's own words: the server's
 * reason when it gave one, not a fixed sentence beside it. Real FileManagerModals and dialog;
 * the file-manager state is a literal, the data source being the one allowed stand-in (its
 * reads are agent I/O), holding only what the dialogs read.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { serverStorageRefusal, type StorageOffer } from '@/lib/revfs/storage-offer';
import type { UseFileManagerContentResult } from '../useFileManagerContent';
import type { FileManagerView } from '../useFileManagerView';
import { FileManagerModals } from '../FileManagerModals';

function shown(storageOffer: StorageOffer): void {
  const fm: UseFileManagerContentResult = {
    fileInputRef: createRef<HTMLInputElement>(), handleDrop: async (): Promise<void> => undefined, takeUploadTarget: (): string => '/',
    storageLimitModalOpen: false, setStorageLimitModalOpen: (): void => undefined, storageUsed: 0, storageQuota: 0, attemptedFileSize: 0,
    place: { openFolder: (): void => undefined }, revfsDisabledModalOpen: true, setRevfsDisabledModalOpen: (): void => undefined,
    revfsDisabledReason: 'server_disabled', storageOffer, tree: null, handleMove: async (): Promise<void> => undefined,
    shownFile: null, setShownFile: (): void => undefined,
  } as unknown as UseFileManagerContentResult;
  const v: FileManagerView = { moving: [], sharing: [], closeMove: (): void => undefined, closeShare: (): void => undefined } as unknown as FileManagerView;
  render(<FileManagerModals fm={fm} v={v} />);
}

describe('the dialog for a drop on refused storage', () => {
  it('says the server\'s own reason', () => {
    const reason: string = serverStorageRefusal({ BackendCannotStoreStreamedObjects: { backend: 'InMemory' } });
    shown({ kind: 'refused', reason });
    expect(screen.getByRole('dialog', { name: 'Remote Storage Unavailable' })).toHaveTextContent(reason);
  });

  it('is not open while the offer is not refused', () => {
    shown({ kind: 'checking' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
