/**
 * The message-plane signals a peer sends about a transfer: the offer, the
 * answer, a cancel, and a completion. Moved out of service.ts, which routes
 * them here.
 *
 * Two of them exist for reloads (reload-recovery.ts):
 *   - an offer can arrive AGAIN, under the same transfer id, when the sender's
 *     page reloaded before its agent confirmed the send and sent it once more.
 *     It is the same transfer: it is not recorded twice, the recipient is not
 *     asked twice, and an offer they already accepted stays accepted;
 *   - a completion, which reaches a page that reloaded across the last tick.
 */
import {
  type MessagingLayer, type FileTransferCompleteData, type FileTransferRequestData,
  MessagingLayerType, isFileTransferRequest, isFileTransferResponse, isFileTransferCancel,
} from '@/types/messaging-layer';
import { handleTransferRequest, handleTransferResponse, type AsyncTransferDeps } from './async-transfers';
import { handleTransferCancel } from './p2p-transfers';
import { applyTransferOutcome, isTerminalTransferState } from './transfer-outcome';
import type { ProtocolOfferCorrelator } from './protocol-offer-correlation';
import type { FileTransfer, IncomingFileTransferMessage } from './types';

export interface PeerSignalDeps extends AsyncTransferDeps {
  correlator: ProtocolOfferCorrelator;
  noteOfferArriving: (transferId: string) => void;
  getAutoAccept: (peerCid: string, transferId: string) => boolean;
  acceptTransfer: (transferId: string) => Promise<void>;
}

type CompleteLayer = { type: MessagingLayerType.FileTransferComplete } & FileTransferCompleteData;
type RequestLayer = { type: MessagingLayerType.FileTransferRequest } & FileTransferRequestData;

export async function handlePeerSignal(deps: PeerSignalDeps, message: IncomingFileTransferMessage): Promise<void> {
  const layer: MessagingLayer = message.layer as MessagingLayer;
  const { senderCid } = message;

  if (isFileTransferRequest(layer)) {
    // Join the two halves BEFORE handleTransferRequest, because auto-accept
    // fires from inside it — and an accept that cannot name the object_id is
    // exactly the failure this correlation exists to prevent. A repeated offer
    // is joined too: its protocol half is a new object_id.
    const known: FileTransfer | undefined = deps.state.getTransfer(layer.transfer_id);
    // Accepted already: its old join names a stream that is gone. Dropped
    // first, since noting the offer can join the new protocol half at once.
    if (known?.isIncoming === true && known.state === 'transferring') deps.io.forgetJoin(known.id);
    deps.noteOfferArriving(layer.transfer_id);
    // Whether it joined is not needed here: an unjoined half is held until its
    // protocol half arrives, and an Accept before then waits for it (awaitObjectId).
    deps.correlator.noteMessageOffer(layer.transfer_id, senderCid, layer.file_name, layer.file_size);
    if (known !== undefined) {
      await handleRepeatedOffer(deps, known);
      return;
    }
    await handleTransferRequest(
      deps, layer as RequestLayer, senderCid,
      (cid: string): boolean => deps.getAutoAccept(cid, layer.transfer_id),
      deps.acceptTransfer,
    );
    await keepJoin(deps, layer.transfer_id);
  } else if (isFileTransferResponse(layer)) {
    await handleTransferResponse(deps, layer, senderCid);
  } else if (isFileTransferCancel(layer)) {
    await handleTransferCancel(deps, layer, senderCid);
  } else if (layer.type === MessagingLayerType.FileTransferComplete) {
    await handlePeerComplete(deps, layer);
  }
  // FileTransferProgress / FileTransferChunk layers have no handlers on
  // purpose: they belonged to an abandoned message-plane transfer that nothing
  // emits. Progress is a protocol notification (see service.ts).
}

/**
 * The sender offered a transfer we already have. Still unanswered: it is the
 * same offer, already on screen. Accepted: the earlier stream is gone with the
 * sender's page, and the new one is accepted without asking again. Finished:
 * nothing to do.
 */
async function handleRepeatedOffer(deps: PeerSignalDeps, transfer: FileTransfer): Promise<void> {
  if (!transfer.isIncoming || transfer.state !== 'transferring') return;
  const tickRequestId: unknown = await deps.io.executeIntent({
    type: 'send-response', transferId: transfer.id, targetCid: transfer.senderCid, accepted: true,
  });
  if (typeof tickRequestId !== 'string' || isTerminalTransferState(transfer.state)) return;
  transfer.tickRequestId = tickRequestId;
  transfer.updatedAt = Date.now();
  await deps.saveTransfer(transfer);
}

/** The protocol half came first, so the join preceded the record: kept on it for a reload. */
async function keepJoin(deps: PeerSignalDeps, transferId: string): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(transferId);
  const objectId: string | undefined = deps.io.objectIdFor(transferId);
  if (transfer === undefined || objectId === undefined || transfer.objectId === objectId) return;
  transfer.objectId = objectId;
  await deps.saveTransfer(transfer);
}

/**
 * The peer's side finished. A sender takes the recipient's word: its own last
 * tick may have gone to no page. A recipient takes the sender's only when it was
 * picked up after a reload; a page attached all along hears its own
 * ReceptionComplete, which carries where the file was saved.
 */
export async function handlePeerComplete(deps: AsyncTransferDeps, data: CompleteLayer): Promise<void> {
  const transfer: FileTransfer | undefined = deps.state.getTransfer(data.transfer_id);
  if (transfer === undefined || isTerminalTransferState(transfer.state) || !data.success) return;
  if (transfer.isIncoming && transfer.resuming !== true) return;
  transfer.resuming = false;
  await applyTransferOutcome(deps, transfer.id, { success: true });
}
