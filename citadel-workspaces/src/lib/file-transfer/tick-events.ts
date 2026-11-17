/**
 * Parsing FileTransferTickNotification into transfer progress/outcome events.
 *
 * The wire gives a tick stream almost nothing to correlate on: TransferTick /
 * ReceptionTick are `[group, total_groups, Mb/s]` tuples and the completes are
 * bare strings — none of them carry an object id. What identifies a stream is
 * its ENVELOPE: `cid` (our session), `peer_cid` (the other side) and
 * `request_id`, which the internal service sets to
 *
 *   - the RespondFileTransfer request UUID for a stream we accepted
 *     (recipient side) — unique per transfer, and
 *   - the SendFile request UUID for a stream we initiated (sender side;
 *     the agent joins the Sender handle to it by SDK ticket), and
 *   - nothing at all for a stream nobody here requested, which is dropped.
 *     Agents before that change stamped sender-side and unrequested streams
 *     alike with the localhost TCP connection UUID — shared by every stream,
 *     so useless as an id; those still fall back to the guess below.
 *
 * So correlation is layered:
 *   1. `ReceptionBeginning(path, metadata)` DOES carry `metadata.object_id`;
 *      the offer correlator has already joined object_id -> transferId, and we
 *      extend that join to the stream's request_id here, so the id-less ticks
 *      and completes that follow resolve exactly.
 *   2. Sender-side events resolve to no transferId here; the service falls
 *      back to matching the active outgoing transfer for (cid, peer_cid) —
 *      see protocol-transfer-events.ts, which also documents the wire
 *      limitation that makes two concurrent sends to one peer ambiguous.
 *
 * RE-VFS uses the same notification type. A revfs pull's stream is recognised
 * at ReceptionBeginning by `metadata.transfer_type !== 'FileTransfer'` and its
 * request_id is remembered as foreign so the stream's later incoming ticks and
 * completes are dropped instead of being pinned on an unrelated chat transfer.
 *
 * OUTGOING streams need the same filter but cannot self-identify: every
 * sender-side variant (TransferBeginning, TransferTick, TransferComplete) is a
 * bare string or tuple with no metadata, so there is no in-stream moment to
 * discover "this is not a chat transfer". A revfs push's ticks DO carry the
 * originating SendFile request_id (the internal service reclaims it via
 * `revfs_correlations.take_push`), so the INITIATOR marks that request_id
 * foreign before sending — see RealProtocolIORouter.markForeignOutgoingStream,
 * called by the async staging upload. Without it, the staging upload's own
 * TransferComplete fell through to the peer-pair fallback and completed the
 * chat transfer it was staging for, while the file was only staged.
 */

import { isVariant } from 'citadel-workspace-client-ts';
import type { FileTransferTickNotification } from './protocol-types';

export type TickDirection = 'outgoing' | 'incoming' | 'unknown';

/** Correlation state owned by the router, threaded into every parse. */
export interface TickCorrelation {
  /** object_id -> transferId, populated by the protocol-offer correlator. */
  objectIdToTransferId: Map<string, string>;
  /** tick-stream request_id -> transferId, learned at accept / ReceptionBeginning. */
  requestIdToTransferId: Map<string, string>;
  /** tick-stream request_id -> local download path from ReceptionBeginning. */
  requestIdToDownloadPath: Map<string, string>;
  /** request_ids of streams that are NOT chat transfers (revfs), to drop. */
  foreignRequestIds: Set<string>;
}

export interface ParsedTickProgress {
  kind: 'progress';
  direction: 'outgoing' | 'incoming';
  transferId?: string;
  cid: bigint;
  peerCid: bigint;
  /**
   * Group counts, not bytes: the wire reports `[group, total_groups]`, so the
   * only byte-accurate figure a tick yields is the percentage. Totals in bytes
   * come from ReceptionBeginning's metadata when available.
   */
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'downloading';
  /** Where the agent is writing a reception (ReceptionBeginning); kept so a reload still knows. */
  downloadPath?: string;
}

export interface ParsedTickComplete {
  kind: 'complete';
  direction: TickDirection;
  transferId?: string;
  cid: bigint;
  peerCid: bigint;
  success: boolean;
  downloadPath?: string;
  errorMessage?: string;
}

export type ParsedTick = ParsedTickProgress | ParsedTickComplete | null;

/** The agent's counts are u64, which reach the page as BigInt whatever the binding says. */
function asCount(value: number | bigint): number {
  return Number(value);
}

function percentage(group: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((group / total) * 100)) : 0;
}

/**
 * Parse one tick notification against the correlation state, registering any
 * new joins it reveals (ReceptionBeginning) as a side effect.
 */
export function parseTickNotification(
  notification: FileTransferTickNotification,
  ctx: TickCorrelation
): ParsedTick {
  const { status, cid } = notification;
  const peerCid: bigint | null = notification.peer_cid;
  const requestId: string | undefined = notification.request_id ?? undefined;

  // No peer means a C2S transfer (server storage), which is not a chat
  // transfer and has nothing in our state to update.
  if (peerCid === null || peerCid === undefined) return null;
  // No request id: the agent is reporting a stream nobody here asked for (a
  // peer storing a file on this node, or this node answering a peer's pull).
  // Placing it by guess is how a peer-storage upload completed a chat send.
  if (requestId === undefined) return null;

  const resolved: string | undefined = requestId ? ctx.requestIdToTransferId.get(requestId) : undefined;
  const isForeign: boolean = requestId !== undefined && ctx.foreignRequestIds.has(requestId);

  if (status === 'TransferBeginning') {
    // Foreign OUTGOING stream (revfs push / async staging upload): its
    // progress must not pull an unrelated chat transfer into 'transferring'.
    if (isForeign) return null;
    return {
      kind: 'progress', direction: 'outgoing', transferId: resolved,
      cid, peerCid, bytesTransferred: 0, totalBytes: 0, percentage: 0,
      status: 'uploading',
    };
  }

  if (isVariant(status, 'ReceptionBeginning')) {
    const [downloadPath, metadata] = status.ReceptionBeginning;
    if (metadata.transfer_type !== 'FileTransfer') {
      // A revfs stream. Remember its request_id so the id-less ticks and
      // completes that follow are dropped rather than matched by peer-pair
      // against an unrelated chat transfer.
      if (requestId) ctx.foreignRequestIds.add(requestId);
      return null;
    }
    const objectId: string = metadata.object_id.toString();
    const transferId: string | undefined = ctx.objectIdToTransferId.get(objectId) ?? resolved;
    if (requestId) {
      if (transferId) ctx.requestIdToTransferId.set(requestId, transferId);
      ctx.requestIdToDownloadPath.set(requestId, downloadPath);
    }
    return {
      kind: 'progress', direction: 'incoming', transferId,
      cid, peerCid, bytesTransferred: 0,
      totalBytes: Number(metadata.plaintext_length), percentage: 0,
      status: 'downloading', downloadPath,
    };
  }

  if (isVariant(status, 'TransferTick')) {
    if (isForeign) return null;
    const [group, total]: number[] = status.TransferTick.slice(0, 2).map(asCount);
    return {
      kind: 'progress', direction: 'outgoing', transferId: resolved,
      cid, peerCid, bytesTransferred: group, totalBytes: total,
      percentage: percentage(group, total), status: 'uploading',
    };
  }

  if (isVariant(status, 'ReceptionTick')) {
    if (isForeign) return null;
    const [group, total]: number[] = status.ReceptionTick.slice(0, 2).map(asCount);
    return {
      kind: 'progress', direction: 'incoming', transferId: resolved,
      cid, peerCid, bytesTransferred: group, totalBytes: total,
      percentage: percentage(group, total), status: 'downloading',
    };
  }

  if (status === 'TransferComplete') {
    // The twin of the ReceptionComplete guard below. Without it, a staging
    // upload's completion resolved to no transferId and the service's
    // peer-pair fallback marked the pending CHAT transfer 'complete' — a
    // terminal state that then swallowed the recipient's real decline.
    if (isForeign) return null;
    return {
      kind: 'complete', direction: 'outgoing', transferId: resolved,
      cid, peerCid, success: true,
    };
  }

  if (status === 'ReceptionComplete') {
    if (isForeign) return null;
    return {
      kind: 'complete', direction: 'incoming', transferId: resolved,
      cid, peerCid, success: true,
      downloadPath: requestId ? ctx.requestIdToDownloadPath.get(requestId) : undefined,
    };
  }

  if (isVariant(status, 'Fail')) {
    if (isForeign) return null;
    return {
      kind: 'complete', direction: 'unknown', transferId: resolved,
      cid, peerCid, success: false, errorMessage: status.Fail,
    };
  }

  return null;
}
