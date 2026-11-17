/**
 * The announcement is what puts a transfer in the recipient's conversation.
 * `createFileTransferRequest` had no caller, so recipients received bytes with
 * nothing to show for them, and async transfers arrived with no signal at all.
 */
import { describe, it, expect } from 'vitest';
import { buildTransferAnnouncement } from '../transfer-announcement';
import type { FileTransfer } from '../types';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { P2PMessagingLayerPayload } from '@/types/p2p-commands';

function transfer(overrides: Partial<FileTransfer> = {}): FileTransfer {
  return {
    id: 'transfer-1',
    fileName: 'report.pdf',
    fileSize: 2048,
    fileType: 'application/pdf',
        state: 'pending',
    progress: 0,
    senderCid: '11',
    recipientCid: '22',
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 999,
    isIncoming: false,
    ...overrides,
  } as FileTransfer;
}

describe('buildTransferAnnouncement', () => {
  it('produces a FileTransferRequest layer the recipient routes to the bubble handler', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer());

    expect(payload.layer.type).toBe(MessagingLayerType.FileTransferRequest);
    expect(payload.message_type).toBe('file_transfer');
  });

  it('carries the transfer id through, so accept/decline can match the bytes', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer({ id: 'abc-123' }));

    expect((payload.layer as { transfer_id: string }).transfer_id).toBe('abc-123');
  });

  it('gives the chat message its own id, distinct from the transfer id', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer({ id: 'abc-123' }));

    expect(payload.message_id).not.toBe('abc-123');
    expect(payload.message_id).toMatch(/[0-9a-f-]{36}/);
  });

  it('addresses the message between the two parties of the transfer', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer({ senderCid: '11', recipientCid: '22' }));

    expect(payload.sender_cid).toBe(11n);
    expect(payload.recipient_cid).toBe(22n);
  });

  it('carries the file details the bubble renders', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(
      transfer({ fileName: 'a.png', fileSize: 99, fileType: 'image/png', thumbnail: 'data:x' }),
    );
    const layer: { file_name: string; file_size: number; file_type: string; thumbnail?: string; } = payload.layer as { file_name: string; file_size: number; file_type: string; thumbnail?: string };

    expect(layer).toMatchObject({ file_name: 'a.png', file_size: 99, file_type: 'image/png', thumbnail: 'data:x' });
  });

  it('names no transfer method and no staged path: there is one way to send', () => {
    const payload: P2PMessagingLayerPayload = buildTransferAnnouncement(transfer({}));
    expect(payload.layer).not.toHaveProperty('transfer_mode');
    expect(payload.layer).not.toHaveProperty('virtual_path');
  });
});
