/**
 * An upload lands in the folder that is open.
 *
 * Live: with "Root / Sent Files" open, "Upload file" stored the file in Root and
 * the open folder went on saying "This folder is empty". The picker's target
 * was its own `useState('/')`, a second copy of the open folder with a default
 * of its own, so any selection that did not follow the exact click-then-set
 * sequence went to Root.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeScope } from '@/types/revfs-types';
import { useUploadTarget, type UploadTarget } from '../useUploadTarget';
import { FileManagerTopBar } from '../FileManagerTopBar';
import { refreshLabel } from '../useFileManagerView';
import { uploadAvailability } from '../upload-refusal';
import { OFFERED } from '@/lib/revfs/storage-offer';

function target(initial: string): { result: { current: UploadTarget }; rerender: (path: string) => void } {
  const { result, rerender } = renderHook((path: string): UploadTarget => useUploadTarget(path), { initialProps: initial });
  return { result, rerender };
}

describe('the upload target', () => {
  it('is the open folder when nothing named another', () => {
    const t: ReturnType<typeof target> = target('/Docs');
    expect(t.result.current.take()).toBe('/Docs');
  });

  it('follows the user into the folder they opened', () => {
    const t: ReturnType<typeof target> = target('/');
    t.rerender('/Docs/Drafts');
    expect(t.result.current.take()).toBe('/Docs/Drafts');
  });

  it('honours a folder named for one pick, once', () => {
    const t: ReturnType<typeof target> = target('/Docs');
    t.result.current.choose('/Docs/Sub');
    expect(t.result.current.take()).toBe('/Docs/Sub');
    expect(t.result.current.take()).toBe('/Docs');
  });

  it('forgets a named folder when the user navigates away', () => {
    const t: ReturnType<typeof target> = target('/Docs');
    t.result.current.choose('/Docs/Sub');
    t.rerender('/Photos');
    expect(t.result.current.take()).toBe('/Photos');
  });
});

function topBar(path: string): void {
  render(
    <FileManagerTopBar
      storage={{ kind: 'server' }} peers={[]} peersLoading={false} peerName={null} onOpenStorage={vi.fn()}
      folder={{ filterText: '', onFilterChange: vi.fn(), onNewFolder: vi.fn(), onUpload: vi.fn(), upload: uploadAvailability(path, OFFERED) }}
      transfers={{ active: 0, open: false, onToggle: vi.fn() }}
    />,
  );
}

async function openNew(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'New' }));
}

describe('the New menu', () => {
  it('disables Upload with the reason in Sent Files, before a file is picked', async () => {
    topBar('/Sent Files');
    await openNew();
    expect(screen.getByRole('menuitem', { name: /Upload files/ })).toHaveAttribute('data-disabled');
    expect(screen.getByText(/P2P Chat/)).toBeInTheDocument();
  });

  it('offers Upload in an ordinary folder, beside New folder', async () => {
    topBar('/Docs');
    await openNew();
    expect(screen.getByRole('menuitem', { name: /Upload files/ })).not.toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', { name: /New folder/ })).toBeInTheDocument();
  });
});

describe('the refresh button', () => {
  // Measured live: "Sync with peer" sat in the Server Storage toolbar, where there is no peer.
  it('says sync only where there is a peer to sync with', () => {
    expect(refreshLabel(TreeScope.Server)).toBe('Refresh');
    expect(refreshLabel(TreeScope.Peer)).toBe('Sync with peer');
  });
});
