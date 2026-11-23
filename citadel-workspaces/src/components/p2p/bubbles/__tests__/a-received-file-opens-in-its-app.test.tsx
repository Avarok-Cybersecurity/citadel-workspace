/**
 * A received file opens in the app registered for its extension: a click on a .docx opens it in
 * Citadel Docs (a dialog over the conversation), a click on a file no app opens downloads it with
 * a Sonner notice saying why, and the hint says which. Its menu, behind a button (keyboard,
 * touch) and on right-click, offers Open only where an app opens it, and Download.
 *
 * Mocked as in a-received-file-can-be-opened: the agent socket and the tab's session lookup, the
 * two I/O boundaries the bubble's service reaches; and the Docs engine's worker, which the test
 * DOM has none of (the dialog is under test, not the engine). The transfer's bytes come from the
 * conversation's reader, provided as ChatPane provides it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Toaster } from 'sonner';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    canSendRequests: (): boolean => false,
  },
}));
vi.mock('@/lib/cdoc/runtime-loader', () => ({
  loadCdocRuntime: (): Promise<never> => new Promise<never>((): void => undefined),
}));

import { FileTransferBubble } from '../FileTransferBubble';
import { TransferReaderContext, type TransferReader } from '@/components/chat/attachments/attachment-io';
import type { P2PMessage } from '@/lib/p2p';

afterEach(cleanup);

function received(name: string): P2PMessage {
  return {
    id: 'msg-t1', content: `File transfer: ${name}`, sender_cid: 42n, recipient_cid: 7n,
    timestamp: 1, status: 'delivered', message_type: 'file_transfer', transfer_id: 't1',
    file_name: name, file_size: 3000, transfer_mode: 'p2p', transfer_state: 'complete',
  } as P2PMessage;
}

function bubble(name: string, readable: boolean): { downloads: string[]; reads: string[] } {
  const downloads: string[] = [];
  const reads: string[] = [];
  const read: TransferReader = async (id: string): Promise<Uint8Array> => { reads.push(id); return new Uint8Array([1]); };
  render(
    <TransferReaderContext.Provider value={readable ? read : null}>
      <Toaster />
      <FileTransferBubble message={received(name)} isOwn={false} onOpen={(id: string): void => { downloads.push(id); }} />
    </TransferReaderContext.Provider>,
  );
  return { downloads, reads };
}

describe('a received file', () => {
  it('opens a .docx in Citadel Docs on a click, and says it will', async () => {
    const { downloads, reads } = bubble('plan.docx', true);
    expect(screen.getByText('Click to open in Citadel Docs')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('file-transfer-open'));
    expect(await screen.findByTestId('chat-file-opened')).toHaveAttribute('data-app', 'docs');
    expect(downloads).toEqual([]);
    expect(reads).toEqual(['t1']);
  });

  it('downloads a file no app opens, with a notice that says why', async () => {
    const { downloads } = bubble('song.xyz', true);
    expect(screen.getByText('Click to download')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('file-transfer-open'));
    expect(downloads).toEqual(['t1']);
    expect(await screen.findByText('Downloading instead — no app here opens .xyz files')).toBeInTheDocument();
  });

  it('only downloads where the conversation cannot read the file, claiming nothing', () => {
    const { downloads } = bubble('plan.docx', false);
    expect(screen.getByText('Click to download')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('file-transfer-open'));
    expect(downloads).toEqual(['t1']);
    expect(screen.queryByText(/no app here opens/)).toBeNull();
  });

  it('has a menu, from the keyboard and from a right-click, with Open only where an app opens it', () => {
    bubble('plan.odt', true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for plan.odt' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitem').map((i: HTMLElement) => i.textContent)).toEqual(['Open in Citadel Docs', 'Download']);
    cleanup();
    bubble('photo.heic', true);
    fireEvent.contextMenu(screen.getByTestId('file-transfer-open'));
    expect(screen.getAllByRole('menuitem').map((i: HTMLElement) => i.textContent)).toEqual(['Download']);
  });
});
