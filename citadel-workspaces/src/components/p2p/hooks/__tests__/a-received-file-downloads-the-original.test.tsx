/**
 * Clicking a received file downloads the original, under its original name -- like Slack.
 *
 * Owner report: the click "either doesn't open, showing the user only the path in the hidden
 * folder in the home directory, or the download shows a file with the binary extension". The
 * chat's open action showed the agent's save path (FilePreviewDialog) and nothing else: the
 * page never asked the agent for the bytes. Now it reads them over ReadPulledFileChunk and hands
 * the browser a Blob named as the sender named it.
 *
 * Mocked, both I/O boundaries only: the agent socket (answers the chunk read as the agent does,
 * on the app's websocket-message bus) and the browser's object-URL API, which jsdom lacks. The
 * transfer is looked up through the real service; it is spied so the test needs no live offer.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';

const PNG: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const asked: unknown[] = [];

vi.mock('@/lib/websocket-service', async () => {
  const { eventEmitter } = await import('@/lib/event-emitter');
  return {
    websocketService: {
      sendRequest: async (): Promise<void> => undefined,
      sendP2PMessageReliable: async (): Promise<void> => undefined,
      canSendRequests: (): boolean => true,
      sendMessage: async (message: Record<string, unknown>): Promise<void> => {
        asked.push(message);
        const read: { request_id: string; offset: bigint } = message.ReadPulledFileChunk as { request_id: string; offset: bigint };
        queueMicrotask((): void => {
          eventEmitter.emit('websocket-message', {
            ReadPulledFileChunkSuccess: { cid: 7n, request_id: read.request_id, total_size: BigInt(PNG.length), offset: read.offset, data: PNG },
          });
        });
      },
    },
  };
});

import { useP2PFileTransfer } from '../useP2PFileTransfer';
import { createPeerTransport } from '@/lib/chat/transport/peer-transport';
import { peerOpeningPorts } from '@/components/p2p/chat-document/use-chat-documents';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import type { FilePort } from '@/lib/chat/transport/chat-transport';

// The direct chat's own file port: what P2PChat hands the hook.
const BOB: ChatPeer = { cid: 42n, name: 'bob', username: 'bob' };
const files: FilePort | null = createPeerTransport({ peer: BOB, self: null, opening: peerOpeningPorts(BOB) }).files;
import { fileTransferService } from '@/lib/file-transfer';
import type { FileTransfer } from '@/lib/file-transfer/types';

const transfer: FileTransfer = {
  id: 't1', fileName: 'holiday photo.png', fileSize: PNG.length, fileType: '', state: 'complete', progress: 100,
  senderCid: '42', recipientCid: '7', downloadPath: '/home/u/.citadel/transfers/42/holiday photo.png',
  createdAt: 1, updatedAt: 1, isIncoming: true,
};

const downloads: { name: string; type: string; size: number }[] = [];

beforeEach((): void => {
  asked.length = 0;
  downloads.length = 0;
  vi.spyOn(fileTransferService, 'getTransfer').mockImplementation((id: string) => (id === 't1' ? transfer : undefined));
  const blobs: Map<string, Blob> = new Map();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob): string => { const url: string = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; },
    revokeObjectURL: (): void => undefined,
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): void {
    const blob: Blob | undefined = blobs.get(this.href);
    if (blob) downloads.push({ name: this.download, type: blob.type, size: blob.size });
  });
});

afterEach((): void => { cleanup(); vi.restoreAllMocks(); });

describe('clicking a received file', () => {
  it('downloads its bytes under the name it was sent with, typed by what they are', async () => {
    const { result } = renderHook(() => useP2PFileTransfer({ files, recipient: 'bob' }));
    act((): void => { result.current.handleOpenFile('t1'); });
    await waitFor((): void => expect(downloads).toEqual([{ name: 'holiday photo.png', type: 'image/png', size: PNG.length }]));
    expect(asked).toEqual([{ ReadPulledFileChunk: expect.objectContaining({ cid: 7n, peer_cid: 42n, virtual_directory: transfer.downloadPath, offset: 0n }) }]);
    expect(result.current.openedFile).toBeNull();
  });
});
