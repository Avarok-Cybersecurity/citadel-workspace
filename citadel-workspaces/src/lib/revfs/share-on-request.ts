/**
 * The uploader's half of opening a file in shared peer storage.
 *
 * RE-VFS is pusher-owned: when Alice uploads, Bob's agent stores the bytes
 * encrypted for Alice, and only Alice's agent can ever decrypt them (agent test
 * `a_revfs_push_cannot_be_pulled_by_its_recipient`). So "neither of us could
 * download the other's file" was the design, not a fault -- and the fix has to
 * involve the one party who can open it. Bob asks (request-share.ts); Alice's
 * agent pulls the file back from Bob's node and sends it to him as an ordinary
 * transfer named by his request's id. The agent lets her send that path because
 * it wrote it (agent kernel/pulled_files.rs).
 *
 * The answer is an Ack on the request: `false` for a refusal or a failure,
 * `true` once the transfer is on its way. Bob learns the outcome from the
 * transfer itself.
 */
import { RevfsFileState, RevfsOpType, type RevfsNode, type RevfsOperation } from '@/types/revfs-types';
import type { AgentFile } from '@/lib/file-transfer/send-agent-file';
import { debugLog } from '@/lib/debug-config';

/** Why `node` may not be shared by `ownerCid`, or null if it may. */
export function shareRefusal(node: RevfsNode | null, ownerCid: bigint): string | null {
  if (node === null || node.type !== 'file' || !node.fileMetadata) return 'no such file';
  if (node.fileMetadata.uploadedByCid !== ownerCid) return 'not uploaded by this account';
  // Remote: the bytes are on the asker's node, encrypted for us. Anything else
  // (Hosted, Sent, Received) is not ours to pull back.
  if (node.fileState !== RevfsFileState.Remote) return `not a stored file of ours (${node.fileState})`;
  return null;
}

export interface ShareAnswerDeps {
  getTree: (myCid: bigint, peerCid: bigint) => Promise<RevfsNode>;
  findFileInTree: (tree: RevfsNode, path: string) => RevfsNode | null;
  /** Pull our own file back from `peerCid`'s node; resolves with where the agent saved it. */
  pull: (myCid: bigint, peerCid: bigint, path: string) => Promise<string | undefined>;
  sendAgentFile: (myCid: bigint, peerCid: bigint, file: AgentFile, transferId: string) => Promise<void>;
  sendOp: (peerCid: bigint, op: RevfsOperation) => Promise<boolean>;
}

export async function answerShareRequest(
  deps: ShareAnswerDeps,
  askerCid: bigint,
  myCid: bigint,
  request: RevfsOperation,
): Promise<void> {
  const answer = async (success: boolean): Promise<void> => {
    const ack: RevfsOperation = {
      op_id: crypto.randomUUID(), op_type: RevfsOpType.Ack, path: request.path,
      ack_op_id: request.op_id, success, timestamp: Date.now(),
    };
    if (!(await deps.sendOp(askerCid, ack))) {
      debugLog('RevfsService', `[revfs] could not answer share request ${request.op_id} from ${askerCid}`);
    }
  };

  const node: RevfsNode | null = deps.findFileInTree(await deps.getTree(myCid, askerCid), request.path);
  const refusal: string | null = shareRefusal(node, myCid);
  if (refusal !== null || node?.fileMetadata === undefined) {
    debugLog('RevfsService', `[revfs] refusing share of ${request.path} to ${askerCid}: ${refusal}`);
    await answer(false);
    return;
  }

  try {
    const pulled: string | undefined = await deps.pull(myCid, askerCid, request.path);
    if (!pulled) throw new Error('the pull did not say where it saved the file');
    await deps.sendAgentFile(myCid, askerCid, {
      path: pulled, name: node.fileMetadata.fileName, size: node.fileMetadata.fileSize,
    }, request.op_id);
  } catch (error: unknown) {
    console.warn(`[revfs] could not share "${request.path}" with ${askerCid}`, error);
    await answer(false);
    return;
  }
  await answer(true);
}
