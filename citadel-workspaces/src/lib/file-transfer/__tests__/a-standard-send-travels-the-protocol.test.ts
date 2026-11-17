/**
 * "Send File (Recommended)" delivers the file.
 *
 * It staged the bytes as a RE-VFS push into the recipient's node and had the
 * recipient pull them back with `DownloadFile(peer = sender)`. A RE-VFS object is
 * encrypted for, and retrievable only by, the node that pushed it: the pull asks
 * the SENDER's agent for a file it never stored, which is why a Mac opening a
 * Windows peer's transfer showed Windows' "The system cannot find the file
 * specified. (os error 2)", and why every standard send failed in both
 * directions (agent test: a_revfs_push_cannot_be_pulled_by_its_recipient).
 * Nothing about it was Windows-specific except the wording.
 *
 * The browser's bytes now go the one way a recipient can open them: the
 * protocol's FileTransfer, which the recipient accepts (or auto-accepts) like
 * any offer, so its failure and decline reach the sender too.
 */
import { describe, it, expect, vi } from 'vitest';
import { sendFile, acceptTransfer, type LifecycleDeps } from '../transfer-lifecycle';
import { handleTransferRequest, type AsyncTransferDeps } from '../async-transfers';
import { MessagingLayerType, type FileTransferRequestData } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

function lifecycle(transfers: Map<string, FileTransfer>, intents: Array<Record<string, unknown>>): LifecycleDeps {
  return {
    io: {
      getCurrentCid: async (): Promise<bigint> => 100n,
      generateThumbnail: async (): Promise<string> => 't',
      // As the real executor does: the agent holds the file (staging), then the offer goes out.
      executeIntent: async (intent: Record<string, unknown>): Promise<unknown> => {
        intents.push(intent);
        (intent.staging as { onStaged?: () => void } | undefined)?.onStaged?.();
        return undefined;
      },
    },
    state: {
      setTransfer: (t: FileTransfer): void => { transfers.set(t.id, t); },
      getTransfer: (id: string): FileTransfer | undefined => transfers.get(id),
      getSettings: (): { maxFileSize: number } => ({ maxFileSize: 1 << 30 }),
    },
    saveTransfer: async (): Promise<void> => undefined,
    emitStateChange: (): void => undefined,
    saveSettings: async (): Promise<void> => undefined,
    openPeerChannel: async (): Promise<boolean> => true,
    // An agent that does not stage uploads: the inline route, 16 MB.
    agentStagesUploads: async (): Promise<boolean> => false,
    queue: ONLINE_PEER_QUEUE,
  } as unknown as LifecycleDeps;
}

describe('a standard ("async") send', () => {
  it('hands the browser bytes to the protocol transfer, not to RE-VFS staging', async () => {
    const transfers: Map<string, FileTransfer> = new Map();
    const intents: Array<Record<string, unknown>> = [];
    const id: string = await sendFile(lifecycle(transfers, intents), '900', new File(['abc'], 'a.txt'));

    expect(intents.map((i) => i.type)).toEqual(['send-transfer-request']);
    expect(intents[0].file).toBeInstanceOf(File);
    await new Promise((r: (v: unknown) => void) => setTimeout(r, 0));
    expect(transfers.get(id)?.state).toBe('pending');
  });
});

describe('a standard offer on the recipient', () => {
  const offer: FileTransferRequestData & { type: MessagingLayerType.FileTransferRequest } = {
    type: MessagingLayerType.FileTransferRequest,
    transfer_id: 'std-1', file_name: 'a.txt', file_size: 3, file_type: 'text/plain',
    transfer_mode: 'async', timestamp: 1, expiry_timestamp: 9e12,
  } as FileTransferRequestData & { type: MessagingLayerType.FileTransferRequest };

  it('waits to be answered over the protocol, and accepting answers it', async () => {
    const transfers: Map<string, FileTransfer> = new Map();
    const intents: Array<Record<string, unknown>> = [];
    const d: LifecycleDeps = lifecycle(transfers, intents);
    await handleTransferRequest(d as unknown as AsyncTransferDeps, offer, '900', () => false, vi.fn());
    expect(transfers.get('std-1')?.state).toBe('pending');

    await acceptTransfer(d, 'std-1');
    expect(intents).toEqual([expect.objectContaining({ type: 'send-response', transferId: 'std-1', accepted: true })]);
    expect(transfers.get('std-1')?.state).toBe('transferring');
  });
});
