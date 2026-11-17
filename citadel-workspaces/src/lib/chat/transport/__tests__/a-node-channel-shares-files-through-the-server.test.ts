/**
 * A node channel's file goes to the workspace server under the node and is then shared by a
 * message naming it; the attach control says where it goes. A refused upload is never shared and
 * reaches the person as the server's reason. A FileShare message from the server becomes a card.
 */
import { describe, it, expect } from 'vitest';
import type { ChatAttachmentsRequest, ChatAttachmentsResponse, GroupMessageType } from 'citadel-workspace-client-ts';
import { nodeFiles, NODE_FILES_DESTINATION } from '../node-files';
import { groupChatMessage, STORED } from '../group-chat-message';
import type { NodeChatIO } from '../node-chat-io';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import type { GroupMessage } from '@/types/workspace-entities';
import type { FilePort, FileSendReceipt } from '@/lib/chat/transport/chat-transport';

function io(refuse: boolean): Pick<NodeChatIO, 'attachments' | 'shareFile' | 'readFile'> & { shared: SharedFile[]; uploads: string[] } {
  const listeners: Set<(answer: ChatAttachmentsResponse) => void> = new Set();
  const shared: SharedFile[] = [];
  const uploads: string[] = [];
  return {
    shared,
    uploads,
    attachments: {
      answerDeadlineMs: 1000,
      onAnswer: (l: (a: ChatAttachmentsResponse) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
      send: async (request: ChatAttachmentsRequest): Promise<void> => {
        if (!('UploadChunk' in request)) throw new Error('only uploads here');
        const { node_id, sha256, index, total_chunks } = request.UploadChunk;
        uploads.push(node_id);
        const answer: ChatAttachmentsResponse = refuse
          ? { Refused: { node_id, attachment_id: sha256, refusal: 'Denied' } }
          : { ChunkStored: { node_id, attachment_id: sha256, index, stored: index + 1 === total_chunks } };
        queueMicrotask((): void => listeners.forEach((l: (a: ChatAttachmentsResponse) => void): void => l(answer)));
      },
    },
    readFile: async (): Promise<Uint8Array> => new Uint8Array([1, 2, 3, 4]),
    shareFile: async (file: SharedFile): Promise<void> => { shared.push(file); },
  };
}

const picked: File = new File(['four'], 'plan.pdf', { type: 'application/pdf' });

describe('a node channel\'s files', () => {
  it('says beside the attach control that the server keeps them for the channel', () => {
    const port: FilePort = nodeFiles(io(false), 'room-1');
    expect(port.destination).toBe("Stored on the workspace server, readable by this channel's members");
    expect(port.destination).toBe(NODE_FILES_DESTINATION);
    expect(port.modes).toEqual(['server']);
  });

  it('uploads to the node, then shares what it uploaded, reporting what the server stored', async () => {
    const wire: Pick<NodeChatIO, "attachments" | "shareFile" | "readFile"> & { shared: SharedFile[]; uploads: string[]; } = io(false);
    const progress: number[][] = [];
    const receipt: FileSendReceipt = await nodeFiles(wire, 'room-1').send(picked, (done: number, total: number): void => { progress.push([done, total]); });
    expect(receipt).toEqual({ outcome: 'shared' });
    expect(progress).toEqual([[0, 4], [4, 4]]);
    expect(wire.uploads).toEqual(['room-1']);
    expect(wire.shared).toEqual([{ id: await sha256Hex(new Uint8Array([1, 2, 3, 4])), name: 'plan.pdf', size: 4, mime: 'application/pdf' }]);
  });

  it('shares nothing when the server refuses the upload, and says why', async () => {
    const wire: Pick<NodeChatIO, "attachments" | "shareFile" | "readFile"> & { shared: SharedFile[]; uploads: string[]; } = io(true);
    const progress: number[][] = [];
    await expect(nodeFiles(wire, 'room-1').send(picked, (done: number, total: number): void => { progress.push([done, total]); }))
      .rejects.toThrow('You cannot share or open files in this channel.');
    expect(wire.shared).toEqual([]);
    expect(progress).toEqual([[0, 4]]);
  });

  it('shows a FileShare message as the file it shares', () => {
    const kind: GroupMessageType = { FileShare: { attachment_id: 'ab'.repeat(32), name: 'plan.pdf', size_bytes: 4n, mime: 'application/pdf' } };
    const message: GroupMessage = {
      id: 'm1', group_id: 'c', sender_id: 'bob', sender_name: 'Bob', message_type: kind, content: 'plan.pdf',
      timestamp: 1n, reply_to: null, reply_count: 0, mentions: [], edited_at: null, reactions: [],
    };
    expect(groupChatMessage(message, null, STORED).attachment).toEqual({ id: 'ab'.repeat(32), name: 'plan.pdf', size: 4, mime: 'application/pdf' });
  });
});
