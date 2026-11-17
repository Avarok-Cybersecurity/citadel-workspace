/**
 * One chunk of a stored file the agent has pulled, addressed as the pull was: by the file's
 * upload-time virtual directory, in the peer's storage or the server's (peerCid null).
 */
import type { RevfsNode } from '@/types/revfs-types';
import type { PulledChunk, ReadChunkAnswer, RevfsIntentResult } from '@/types/revfs-intents';
import type { FileOpsContext } from './revfs-file-ops';

export async function readPulledChunk(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint | null,
  filePath: string,
  offset: bigint,
  maxLen: number,
): Promise<PulledChunk> {
  const tree: RevfsNode = peerCid === null ? await ctx.getServerTree(myCid) : await ctx.getTree(myCid, peerCid);
  const fileNode: RevfsNode | null = ctx.findFileInTree(tree, filePath);
  if (!fileNode?.fileMetadata) throw new Error(`File not found or has no metadata: ${filePath}`);
  const result: RevfsIntentResult = await ctx.ensureIO().execute({
    type: 'backend-read-pulled-chunk', cid: myCid, peerCid, virtualDir: fileNode.fileMetadata.virtualDirectory, offset, maxLen,
  });
  if (result.type !== 'backend-read-pulled-chunk') throw new Error(`Reading "${filePath}" got a ${result.type} answer.`);
  const answer: ReadChunkAnswer = result.answer;
  if (answer.kind === 'failed') throw new Error(answer.message);
  return answer.chunk;
}
