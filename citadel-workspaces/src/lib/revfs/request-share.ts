/**
 * The asker's half of opening a file in shared peer storage: ask its uploader
 * to send it (see share-on-request.ts for why nobody else can).
 *
 * Bounded twice over. The uploader must answer within SHARE_ANSWER_TIMEOUT_MS
 * -- its pull and its SendFile acknowledgement are each bounded by
 * FILE_SEND_MS -- and once it says yes the request follows that transfer to
 * its terminal state, which the transfer's own failure and expiry signals
 * bound.
 */
import { RevfsOpType, type RevfsOperation } from '@/types/revfs-types';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { TIMEOUT } from '../timeout-constants';

export const SHARE_ANSWER_TIMEOUT_MS: number = 2 * TIMEOUT.FILE_SEND_MS;

export interface RequestShareDeps {
  /** Settles with the transfer the uploader sends under this id. */
  expectShare: (transferId: string) => Promise<FileTransfer>;
  forgetShare: (transferId: string) => void;
  registerAck: (opId: string, timeoutMs: number) => Promise<boolean>;
  cancelAck: (opId: string) => void;
  sendOp: (peerCid: bigint, op: RevfsOperation) => Promise<boolean>;
}

/** Why the uploader could not be the one to open it, in words for a toast. */
export function shareFailure(ownerLabel: string, reason: 'unsent' | 'unanswered' | 'refused'): string {
  const only: string = `Only ${ownerLabel}'s agent can open this file, so ${ownerLabel} has to send it`;
  switch (reason) {
    case 'unsent': return `${only}, and the request could not reach them. Are they online?`;
    case 'unanswered': return `${only}, and did not answer. They need to be online with Citadel open.`;
    case 'refused': return `${only}, and their agent could not. Ask them to check it is still in your shared storage.`;
  }
}

/** Ask `ownerCid` to send the file at `path`; resolves with where it was saved. */
export async function requestShare(
  deps: RequestShareDeps,
  ownerCid: bigint,
  ownerLabel: string,
  path: string,
): Promise<string | undefined> {
  const op: RevfsOperation = {
    op_id: crypto.randomUUID(), op_type: RevfsOpType.ShareRequest, path, timestamp: Date.now(),
  };
  // Both registered before the request leaves: the answer and the offer can
  // arrive at once.
  const delivered: Promise<FileTransfer> = deps.expectShare(op.op_id);
  const answered: Promise<boolean> = deps.registerAck(op.op_id, SHARE_ANSWER_TIMEOUT_MS);

  const fail = (reason: 'unsent' | 'unanswered' | 'refused'): never => {
    deps.forgetShare(op.op_id);
    throw new Error(shareFailure(ownerLabel, reason));
  };

  if (!(await deps.sendOp(ownerCid, op))) {
    deps.cancelAck(op.op_id);
    fail('unsent');
  }
  let accepted: boolean;
  try {
    accepted = await answered;
  } catch {
    return fail('unanswered');
  }
  if (!accepted) fail('refused');

  return (await delivered).downloadPath;
}
