/**
 * A picture sent in a chat shows in its bubble, and opens full size with a Download under its
 * original name.
 *
 * Owner: "When a picture is sent, a thumbnail/preview should render within the text area
 * professionally; then, when it's clicked, a modal opens showing the full-sized image". The
 * bubble showed a 40px icon slot, filled with whatever string the sender's offer carried as
 * `thumbnail` -- drawn as an <img src> as given, so a remote URL loaded the moment the chat
 * rendered.
 *
 * Mocked, the I/O boundaries only: the agent socket (answers ReadPulledFileChunk with a real
 * 1x1 PNG, as the agent does), the browser's object-URL API jsdom lacks, and the service's
 * transfer lookups, standing in for transfers that arrived.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const PNG_1X1: number[] = Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c: string): number => c.charCodeAt(0));

vi.mock('@/lib/websocket-service', async () => {
  const { eventEmitter } = await import('@/lib/event-emitter');
  return {
    websocketService: {
      sendRequest: async (): Promise<void> => undefined,
      sendP2PMessageReliable: async (): Promise<void> => undefined,
      canSendRequests: (): boolean => true,
      sendMessage: async (message: Record<string, unknown>): Promise<void> => {
        const read: { request_id: string; offset: bigint } = message.ReadPulledFileChunk as { request_id: string; offset: bigint };
        queueMicrotask((): void => {
          eventEmitter.emit('websocket-message', {
            ReadPulledFileChunkSuccess: { cid: 7n, request_id: read.request_id, total_size: BigInt(PNG_1X1.length), offset: read.offset, data: PNG_1X1 },
          });
        });
      },
    },
  };
});

import { FileTransferBubble } from '../FileTransferBubble';
import { fileTransferService } from '@/lib/file-transfer';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { P2PMessage } from '@/lib/p2p';

function transfer(id: string, at: number): FileTransfer {
  return {
    id, fileName: `${id}.png`, fileSize: PNG_1X1.length, fileType: 'image/png', state: 'complete', progress: 100,
    senderCid: '42', recipientCid: '7', downloadPath: `/agent/transfers/42/${id}.png`, createdAt: at, updatedAt: at, isIncoming: true,
  };
}

function bubbleOf(t: FileTransfer, thumbnail?: string): P2PMessage {
  return {
    id: `msg-${t.id}`, content: `File transfer: ${t.fileName}`, senderCid: 42n, recipientCid: 7n, timestamp: 1, status: 'delivered',
    message_type: 'file_transfer', transfer_id: t.id, file_name: t.fileName, file_size: t.fileSize, file_type: t.fileType,
    file_thumbnail: thumbnail, transfer_mode: 'p2p', transfer_state: 'complete',
  } as P2PMessage;
}

const known: FileTransfer[] = [transfer('beach', 1), transfer('dunes', 2)];
const downloads: { name: string; type: string }[] = [];

beforeEach((): void => {
  downloads.length = 0;
  vi.spyOn(fileTransferService, 'getTransfer').mockImplementation((id: string) => known.find((t: FileTransfer): boolean => t.id === id));
  vi.spyOn(fileTransferService, 'getTransfersForPeer').mockImplementation((): FileTransfer[] => known);
  const blobs: Map<string, Blob> = new Map();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob): string => { const url: string = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; },
    revokeObjectURL: (): void => undefined,
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): void {
    const blob: Blob | undefined = blobs.get(this.href);
    if (blob) downloads.push({ name: this.download, type: blob.type });
  });
});
afterEach((): void => { cleanup(); vi.restoreAllMocks(); });

describe('a received picture', () => {
  it('shows in its bubble from the bytes the agent holds', async () => {
    render(<FileTransferBubble message={bubbleOf(known[0])} isOwn={false} />);
    const picture: HTMLElement = await screen.findByRole('button', { name: 'View beach.png full size' });
    const img: HTMLImageElement = picture.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(img.dataset.shown).toBe('picture');
  });

  it('opens full size, moves to the next with the arrow key, and downloads under its own name', async () => {
    render(<FileTransferBubble message={bubbleOf(known[0])} isOwn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View beach.png full size' }));
    const viewer: HTMLElement = await screen.findByRole('dialog', { name: 'beach.png' });
    expect(viewer.textContent).toContain('1 of 2');
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    await screen.findByRole('dialog', { name: 'dunes.png' });
    const download: HTMLElement = screen.getByTestId('picture-viewer-download');
    await waitFor((): void => expect((download as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(download);
    expect(downloads).toEqual([{ name: 'dunes.png', type: 'image/png' }]);
  });
});

describe("a sender's thumbnail", () => {
  it('is not drawn when it is a remote URL', () => {
    const pending: FileTransfer = { ...transfer('remote', 3), state: 'pending' };
    known.push(pending);
    const { container } = render(<FileTransferBubble message={{ ...bubbleOf(pending, 'https://tracker.example/p.png'), transfer_state: 'pending' }} isOwn={false} />);
    expect(container.querySelector('img[src^="https:"]')).toBeNull();
    known.pop();
  });
});
