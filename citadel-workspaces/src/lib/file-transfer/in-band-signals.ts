/**
 * In-band accept/decline and cancel signals.
 *
 * The protocol's RespondFileTransfer travels only between OUR browser and OUR
 * internal service; the sender's UI learns of an accept indirectly (its tick
 * stream starts) and of a DECLINE not at all — the SDK gives the declined
 * sender no notification whatsoever, so before these signals existed the
 * sender's bubble sat on "Waiting for acceptance" forever. Cancel has no
 * protocol command at all (cancellation is implicit in disconnect), so
 * without an in-band signal the recipient's bubble outlived the transfer.
 *
 * These are ordinary P2P messages carrying FileTransferResponse /
 * FileTransferCancel layers; the peer's message-handler routing forwards them
 * to its FileTransferService (async-transfers.handleTransferResponse and
 * p2p-transfers.handleTransferCancel), which moves the bubble to its terminal
 * state.
 */

import { sendAllowingForAConcurrentOpen } from '../p2p/message-send-operations';
import {
  createFileTransferResponse,
  createFileTransferCancel,
  MessagingLayerType,
  type MessagingLayer,
} from '@/types/messaging-layer';
import type { P2PMessagingLayerPayload } from '@/types/p2p-commands';
import { P2PCommandType, serializeP2PCommand, type P2PCommand } from '@/types/p2p-types';
import { compressionHintFor } from '../p2p/compression-hints';
import { buildLayerPayload } from './transfer-announcement';
import { debugLog } from '@/lib/debug-config';

/**
 * Serialize a layer payload and send it over the reliable P2P channel.
 *
 * Through the message path's own send, which opens this session's messenger
 * first. Sending straight to `sendP2PMessageReliable` skipped that, so once
 * an agent reconnect or server restart had dropped the handle, every file
 * offer, accept, decline and cancel failed with "No messaging handle found
 * for local CID" -- while a text message to the same peer reopened it and
 * went through.
 */
export async function sendLayerPayload(payload: P2PMessagingLayerPayload): Promise<void> {
  const command: P2PCommand = { type: P2PCommandType.MessagingLayerCommand, payload };
  const bytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);
  await sendAllowingForAConcurrentOpen(payload.sender_cid, payload.recipient_cid, bytes, compressionHintFor(command));
}

/** Tell the sender we accepted or declined their offer. */
export async function sendTransferResponseSignal(
  ownCid: bigint,
  peerCid: bigint,
  transferId: string,
  accepted: boolean,
  declineReason?: string
): Promise<void> {
  debugLog('in-band-signals', 'sending transfer response', {
    transferId, accepted, peerCid: peerCid.toString(),
  });
  await sendLayerPayload(
    buildLayerPayload(
      createFileTransferResponse(transferId, accepted, declineReason),
      ownCid,
      peerCid
    )
  );
}

/** Tell the peer this transfer is over: cancelled, or `failed` on this side. */
export async function sendTransferCancelSignal(
  ownCid: bigint,
  peerCid: bigint,
  transferId: string,
  reason: string | undefined,
  failed: boolean
): Promise<void> {
  debugLog('in-band-signals', 'sending transfer cancel', {
    transferId, peerCid: peerCid.toString(),
  });
  await sendLayerPayload(
    buildLayerPayload(createFileTransferCancel(transferId, reason, failed), ownCid, peerCid)
  );
}

/**
 * Tell the peer this transfer finished on this side.
 *
 * The protocol reports completion only to the page attached when the last tick
 * goes out (tick_updater.rs drops ticks nobody is attached for). A page that
 * reloaded across that moment never heard it, and its bubble waited for ever
 * on a transfer that had finished (reload-recovery.ts). This message is
 * delivered by the messaging layer whenever the peer is back, so it reaches a
 * page the tick missed.
 */
export async function sendTransferCompleteSignal(ownCid: bigint, peerCid: bigint, transferId: string): Promise<void> {
  const layer: MessagingLayer = { type: MessagingLayerType.FileTransferComplete, transfer_id: transferId, success: true, timestamp: Date.now() };
  await sendLayerPayload(buildLayerPayload(layer, ownCid, peerCid));
}
