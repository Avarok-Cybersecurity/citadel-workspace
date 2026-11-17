/**
 * Server Storage is offered only once the server has said it stores files. Before
 * GetServerCapabilities answers there is no upload control, only "checking"; a server that
 * answers false gets none either, with why; a server that answers true gets one. A default that
 * assumed storage until the answer is what showed, in the stack, an upload the server refused.
 *
 * Real: useServerRevfsTree, the availability rule and the New menu. Doubled, each because the
 * thing is I/O this test does not have: the capabilities request (its answer arrives on the
 * event the workspace response handler emits, which the test emits) and the server tree load
 * (revfsService, answered with nothing, so the hook stays on the capabilities it is given).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { eventEmitter } from '@/lib/event-emitter';
import workspaceService from '@/lib/workspace-service';
import { revfsService } from '@/lib/revfs';
import { useServerRevfsTree } from '@/hooks/useServerRevfsTree';
import type { ServerCapabilities, UseServerRevfsTreeResult } from '@/hooks/useRevfsTree-types';
import { SERVER_STORAGE_CHECKING, SERVER_STORAGE_OFF } from '@/lib/revfs/storage-offer';
import type { ServerFeatureRefusal } from 'citadel-workspace-client-ts';
import { FileManagerTopBar } from '../FileManagerTopBar';
import { uploadAvailability } from '../upload-refusal';

afterEach(() => { vi.restoreAllMocks(); });

function Harness(): JSX.Element {
  const server: UseServerRevfsTreeResult = useServerRevfsTree(7n);
  return (
    <FileManagerTopBar
      storage={{ kind: 'server' }} peers={[]} peersLoading={false} peerName={null} onOpenStorage={(): void => undefined}
      folder={{ filterText: '', onFilterChange: (): void => undefined, onNewFolder: (): void => undefined, onUpload: (): void => undefined, upload: uploadAvailability('/Docs', server.storageOffer) }}
      transfers={{ active: 0, open: false, onToggle: (): void => undefined }}
    />
  );
}

async function openNew(): Promise<void> {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'New' }));
}

// No reason by default: what a server older than the reason sends, and what an on feature carries.
const answer = (allowServerRevfsStorage: boolean, revfsStorageRefusal: ServerFeatureRefusal | null = null): ServerCapabilities => ({ allowServerFileTransfer: allowServerRevfsStorage, allowServerRevfsStorage, maxFileTransferSizeMb: 100, revfsStorageQuotaMb: 100, revfsStorageRefusal });

describe('Server Storage before and after the server answers', () => {
  it('offers no upload while the server has not answered, and says it is checking', async () => {
    vi.spyOn(workspaceService, 'getServerCapabilities').mockReturnValue(new Promise<never>((): void => undefined));
    vi.spyOn(revfsService, 'getServerTree').mockReturnValue(new Promise<never>((): void => undefined));
    await openNew();
    expect(screen.queryByTestId('vfs-new-upload')).toBeNull();
    expect(screen.getByTestId('vfs-upload-unavailable')).toHaveTextContent(SERVER_STORAGE_CHECKING);
  });

  it('offers none when the server says it stores no files, and says so', async () => {
    vi.spyOn(workspaceService, 'getServerCapabilities').mockReturnValue(new Promise<never>((): void => undefined));
    vi.spyOn(revfsService, 'getServerTree').mockReturnValue(new Promise<never>((): void => undefined));
    await openNew();
    act((): void => { eventEmitter.emit('server:capabilities:loaded', answer(false)); });
    expect(screen.queryByTestId('vfs-new-upload')).toBeNull();
    expect(screen.getByTestId('vfs-upload-unavailable')).toHaveTextContent(SERVER_STORAGE_OFF);
  });

  it.each<[string, ServerFeatureRefusal, string]>([
    ['turned off', 'DisabledByConfig', 'Server storage is turned off on this server.'],
    ['without a backend', 'NoBackend', 'The server has no storage backend.'],
    ['on a backend that cannot hold files', { BackendCannotStoreStreamedObjects: { backend: 'InMemory' } }, 'This server\'s InMemory storage cannot hold files.'],
  ])('says the server\'s own reason when its storage is %s', async (_case: string, refusal: ServerFeatureRefusal, said: string) => {
    vi.spyOn(workspaceService, 'getServerCapabilities').mockReturnValue(new Promise<never>((): void => undefined));
    vi.spyOn(revfsService, 'getServerTree').mockReturnValue(new Promise<never>((): void => undefined));
    await openNew();
    act((): void => { eventEmitter.emit('server:capabilities:loaded', answer(false, refusal)); });
    expect(screen.queryByTestId('vfs-new-upload')).toBeNull();
    expect(screen.getByTestId('vfs-upload-unavailable')).toHaveTextContent(said);
  });

  it('offers the upload once the server says it stores files', async () => {
    vi.spyOn(workspaceService, 'getServerCapabilities').mockReturnValue(new Promise<never>((): void => undefined));
    vi.spyOn(revfsService, 'getServerTree').mockReturnValue(new Promise<never>((): void => undefined));
    await openNew();
    act((): void => { eventEmitter.emit('server:capabilities:loaded', answer(true)); });
    expect(screen.getByTestId('vfs-new-upload')).toHaveTextContent('Upload files');
    expect(screen.queryByTestId('vfs-upload-unavailable')).toBeNull();
  });
});
