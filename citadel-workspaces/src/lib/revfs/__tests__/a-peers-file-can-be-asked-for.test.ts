/**
 * In shared peer storage, either person can open the other's file.
 *
 * Live: Alexi could not download Thomas's file and Thomas could not download
 * Alexi's. RE-VFS is pusher-owned -- the peer's agent holds the upload encrypted
 * for the uploader -- so only the uploader can open it, and the asker has to
 * ask them to send it. Here both halves run for real against each other: the
 * asker's request-share and the uploader's share-on-request, joined by the real
 * RevfsState ack registry and the real RequestedShares. Faked: the wire between
 * them, the uploader's pull from the asker's node, and its SendFile -- the
 * three agent round trips this process has no agent for.
 */
import { describe, it, expect, vi } from 'vitest';
import { RevfsFileState, RevfsOpType, type RevfsNode, type RevfsOperation } from '@/types/revfs-types';
import { RevfsState } from '../revfs-state';
import { requestShare, SHARE_ANSWER_TIMEOUT_MS, type RequestShareDeps } from '../request-share';
import { answerShareRequest, shareRefusal, type ShareAnswerDeps } from '../share-on-request';
import { RequestedShares } from '@/lib/file-transfer/requested-shares';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { AgentFile } from '@/lib/file-transfer/send-agent-file';

const THOMAS: bigint = 1n; // uploader
const ALEXI: bigint = 2n;  // asker

function fileNode(uploadedBy: bigint, state: RevfsFileState): RevfsNode {
  return {
    name: 'atlas.png', path: '/atlas.png', type: 'file', fileState: state, createdAt: 0, updatedAt: 0,
    fileMetadata: { fileId: 'f', fileName: 'atlas.png', fileSize: 1400, fileType: 'image/png', virtualDirectory: '/atlas.png', uploadedByCid: uploadedBy },
  };
}

function rig(
  ownersView: RevfsNode | null,
  pull: ShareAnswerDeps['pull'] = async (): Promise<string | undefined> => '/thomas/transfers/2/atlas.png',
): { asker: RequestShareDeps; sent: AgentFile[]; shares: RequestedShares } {
  const askerState: RevfsState = new RevfsState();
  const shares: RequestedShares = new RequestedShares();
  const sent: AgentFile[] = [];
  const owner: ShareAnswerDeps = {
    getTree: async (): Promise<RevfsNode> => ({ name: '/', path: '/', type: 'directory', children: [], createdAt: 0, updatedAt: 0 }),
    findFileInTree: (): RevfsNode | null => ownersView,
    pull,
    sendAgentFile: async (_me: bigint, _to: bigint, file: AgentFile, transferId: string): Promise<void> => {
      sent.push(file);
      // The transfer the asker's browser then accepts and completes.
      queueMicrotask(() => shares.settle({ id: transferId, state: 'complete', downloadPath: '/alexi/transfers/1/atlas.png' } as FileTransfer));
    },
    // Owner -> asker: its Ack lands in the asker's registry.
    sendOp: async (_to: bigint, op: RevfsOperation): Promise<boolean> => { askerState.resolveAck(op.ack_op_id ?? '', op.success ?? false); return true; },
  };
  const asker: RequestShareDeps = {
    expectShare: (id: string) => shares.expect(id),
    forgetShare: (id: string) => shares.forget(id),
    registerAck: (id: string, ms: number) => askerState.registerAck(id, ms),
    cancelAck: (id: string) => askerState.cancelAck(id),
    // Asker -> owner.
    sendOp: async (_to: bigint, op: RevfsOperation): Promise<boolean> => {
      expect(op.op_type).toBe(RevfsOpType.ShareRequest);
      void answerShareRequest(owner, ALEXI, THOMAS, op);
      return true;
    },
  };
  return { asker, sent, shares };
}

describe('asking the uploader for a file in shared storage', () => {
  it('gets their file: they pull it back and send it, and it lands here', async () => {
    const { asker, sent } = rig(fileNode(THOMAS, RevfsFileState.Remote));
    await expect(requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png')).resolves.toBe('/alexi/transfers/1/atlas.png');
    expect(sent).toEqual([{ path: '/thomas/transfers/2/atlas.png', name: 'atlas.png', size: 1400 }]);
  });

  it('is refused, in words, when the file is not theirs to send', async () => {
    const { asker, sent, shares } = rig(fileNode(ALEXI, RevfsFileState.Hosted));
    await expect(requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png')).rejects.toThrow(/Only Thomas Braun's agent can open this file/);
    expect(sent).toHaveLength(0);
    expect(shares.isExpected('anything')).toBe(false);
  });

  it('is refused when their pull fails, rather than waiting for a file that will not come', async () => {
    const { asker, sent } = rig(fileNode(THOMAS, RevfsFileState.Remote), async () => { throw new Error('ENOENT'); });
    await expect(requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png')).rejects.toThrow(/their agent could not/);
    expect(sent).toHaveLength(0);
  });

  it('is refused when the pull reports no saved file, rather than sending a path that is not there', async () => {
    const { asker, sent } = rig(fileNode(THOMAS, RevfsFileState.Remote), async () => undefined);
    await expect(requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png')).rejects.toThrow(/their agent could not/);
    expect(sent).toHaveLength(0);
  });

  it('says they must be online when the request cannot leave', async () => {
    const { asker } = rig(null);
    asker.sendOp = async (): Promise<boolean> => false;
    await expect(requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png')).rejects.toThrow(/could not reach them/);
  });

  it('gives up after the answer window when nobody answers', async () => {
    vi.useFakeTimers();
    const { asker } = rig(null);
    asker.sendOp = async (): Promise<boolean> => true; // delivered, never answered
    const asked: Promise<string | undefined> = requestShare(asker, THOMAS, 'Thomas Braun', '/atlas.png');
    const verdict: Promise<unknown> = asked.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SHARE_ANSWER_TIMEOUT_MS + 1);
    expect(String(await verdict)).toMatch(/did not answer/);
    vi.useRealTimers();
  });
});

describe('what the uploader agrees to share', () => {
  it('is only a file it uploaded and the peer stores for it', () => {
    expect(shareRefusal(fileNode(THOMAS, RevfsFileState.Remote), THOMAS)).toBeNull();
    expect(shareRefusal(fileNode(ALEXI, RevfsFileState.Remote), THOMAS)).toMatch(/not uploaded/);
    expect(shareRefusal(fileNode(THOMAS, RevfsFileState.Sent), THOMAS)).toMatch(/not a stored file/);
    expect(shareRefusal(null, THOMAS)).toMatch(/no such file/);
  });
});
