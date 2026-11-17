/**
 * File Transfer I/O Router - Real Protocol Implementation
 *
 * This file provides backward compatibility during the migration to IFileTransferIORouter.
 * It wraps RealProtocolIORouter with the intent-based pattern for existing code.
 *
 * Uses the native SendFile/RespondFileTransfer commands instead of P2P messaging.
 * Requires file paths (from PickFile) rather than browser File objects.
 *
 * @deprecated Use IFileTransferIORouter and RealProtocolIORouter directly.
 */

import { TIMEOUT } from '../timeout-constants';
import { websocketService } from '../websocket-service';
import { RealProtocolIORouter } from './real-protocol-io-router';
import type { FileSource } from './io-router-types';
import type {
  FileTransferIntent,
  SendResponseIntent,
  SendCancelIntent,
  SendCompleteIntent,
  PickFileIntent,
  FileTransfer,
  SendFileViaProtocolIntent,
  FilePickerResult,
} from './types';
import { debugLog } from '@/lib/debug-config';
import { announceTransfer, executeSendTransferRequest } from './send-transfer-request';
import { sendTransferCancelSignal, sendTransferCompleteSignal, sendTransferResponseSignal } from './in-band-signals';
import { awaitSendFileAck } from './server-upload';

/**
 * @deprecated Use RealProtocolIORouter with IFileTransferIORouter interface instead.
 * This class maintains backward compatibility with the intent-based pattern.
 */
export class FileTransferIO extends RealProtocolIORouter {
  // ============================================================================
  // Intent Execution (backward compatibility)
  // ============================================================================

  async executeIntent(intent: FileTransferIntent): Promise<unknown> {
    switch (intent.type) {
      case 'send-transfer-request':
        return executeSendTransferRequest(this, intent);
      case 'send-response':
        return this.executeSendResponse(intent);
      case 'send-cancel':
        return this.executeSendCancel(intent);
      case 'send-complete':
        return this.executeSendComplete(intent);
      case 'pick-file':
        return this.pickFile(intent);
      case 'send-file-via-protocol':
        return this.sendFileViaProtocol(intent);
      default: {
        const exhaustiveCheck: never = intent;
        throw new Error(`Unknown intent type: ${(exhaustiveCheck as FileTransferIntent).type}`);
      }
    }
  }

  // ============================================================================
  // Intent Adapters (convert old intent pattern to new interface)
  // ============================================================================

  /**
   * Follow a transfer restored after a reload (reload-recovery.ts): the agent
   * still holds it and names it by the ids the record kept.
   */
  reattach(transfer: FileTransfer): void {
    if (transfer.tickRequestId !== undefined) this.noteOutgoingStream(transfer.tickRequestId, transfer.id);
    if (transfer.objectId !== undefined) this.registerTransferMapping(transfer.id, transfer.objectId);
  }

  /** The object_id an incoming offer joined, which a reload needs to answer it. */
  objectIdFor(transferId: string): string | undefined {
    return this.transferIdToObjectId.get(transferId);
  }

  /** Drop an offer's join, so its next protocol half (a repeated offer) is the one answered. */
  forgetJoin(transferId: string): void {
    const objectId: string | undefined = this.transferIdToObjectId.get(transferId);
    if (objectId !== undefined) this.objectIdToTransferId.delete(objectId);
    this.transferIdToObjectId.delete(transferId);
  }

  private async executeSendComplete(intent: SendCompleteIntent): Promise<void> {
    const ownCid: bigint | null = await this.getCurrentCid();
    if (ownCid === null) throw new Error('No active session to report this transfer from.');
    await sendTransferCompleteSignal(ownCid, intent.targetCid, intent.transferId);
  }

  /** Resolves to the request id an accepted stream's ticks carry, which a reload needs. */
  private async executeSendResponse(intent: SendResponseIntent): Promise<string> {
    // The protocol names a transfer by its numeric object_id; the in-band
    // announcement names it by a UUID. Accept/decline go back over the PROTOCOL,
    // so the UUID has to be translated. Passing it through reached
    // `BigInt(<uuid>)`, which throws SyntaxError synchronously while the request
    // literal is built — before anything is sent — so RespondFileTransfer was
    // never issued for any incoming transfer and the bytes never landed.
    //
    // Waited for, not just looked up: the protocol half of a large file trails its bubble (see
    // awaitObjectId). The sender's own SendFile gives up after FILE_SEND_MS, so waiting longer
    // than that could only ever end in the same refusal.
    const objectId: string | undefined = await this.awaitObjectId(intent.transferId, TIMEOUT.FILE_SEND_MS);
    if (objectId === undefined) {
      throw new Error(
        'This transfer has not been announced over the protocol yet. ' +
          'Wait a moment and try again.'
      );
    }
    // The LOCAL session's CID. This was `BigInt(0)` with the comment "Not used
    // for message-based" -- but the internal service looks the connection up by
    // exactly this field (`server_connection_map.get_mut(&cid)` in
    // respond_file_transfer.rs), and nothing is filed under 0. Every accept and
    // every decline came back "Connection not found", with `cid: 0` on the
    // failure notification so CID routing could not even deliver it to a tab.
    // The send was fire-and-forget, so nothing noticed: the recipient's bubble
    // sat at "Downloading... 0%" and the sender's at "Waiting for acceptance"
    // for ever, and no chat transfer ever moved a byte.
    const ownCid: bigint | null = await this.getCurrentCid();
    if (ownCid === null) {
      throw new Error('No active session to accept this transfer with.');
    }
    const tickRequestId: string = await this.respondToTransfer({
      protocolId: objectId,
      // Lets the router pre-register the reception tick stream: an accept
      // spawns that stream under the RespondFileTransfer request UUID, and
      // its ticks carry no other usable id (see tick-events.ts).
      transferId: intent.transferId,
      cid: ownCid,
      peerCid: BigInt(intent.targetCid),
      accept: intent.accepted,
      // No download location. `intent.reason` used to be passed here, with the
      // note "using reason as download location in old API" — but `reason` is a
      // decline/cancel message ("Sender cancelled transfer"), not a path.
      //
      // It has cost nothing because the internal service discards the field:
      // respond_file_transfer.rs destructures `download_location: _` under a
      // TODO. That is exactly what makes it worth removing now rather than
      // later — the day someone implements that TODO, this would start writing
      // files to paths named after decline reasons, and the bug would look like
      // it came from the server change.
    });

    // The protocol respond above reaches only OUR internal service. The
    // sender's UI learns of an accept when its tick stream starts, but a
    // DECLINE produces no signal on their side at all — their bubble would
    // wait for acceptance forever. The in-band response is what moves the
    // sender's bubble to 'declined' (and gives an accepted send an early
    // 'transferring'), so it is sent for both outcomes.
    await sendTransferResponseSignal(
      ownCid,
      BigInt(intent.targetCid),
      intent.transferId,
      intent.accepted,
      intent.accepted ? undefined : intent.reason
    );
    return tickRequestId;
  }

  private async executeSendCancel(intent: SendCancelIntent): Promise<void> {
    // The protocol has no cancel command — cancellation is implicit in
    // disconnect — so `cancelTransfer` below only clears local correlation
    // state. Without the in-band signal the peer was never told, and their
    // bubble stayed pending/transferring for a transfer that no longer
    // existed. Signal first: local cleanup cannot fail, the send can.
    const ownCid: bigint | null = await this.getCurrentCid();
    if (ownCid === null) {
      throw new Error('No active session to cancel this transfer from.');
    }
    await sendTransferCancelSignal(
      ownCid,
      BigInt(intent.targetCid),
      intent.transferId,
      intent.reason,
      intent.failed
    );
    await this.cancelTransfer({
      transferId: intent.transferId,
      targetCid: BigInt(intent.targetCid),
      reason: intent.reason,
    });
  }

  // ============================================================================
  // Native File Picker
  // ============================================================================

  private async pickFile(intent: PickFileIntent): Promise<FilePickerResult> {
    return websocketService.pickFile(intent.cid, intent.title, intent.allowedExtensions);
  }

  // ============================================================================
  // Protocol-Level File Send (for native file picker flow)
  // ============================================================================

  private async sendFileViaProtocol(intent: SendFileViaProtocolIntent): Promise<void> {
    // Announce BEFORE the bytes, exactly as executeSendTransferRequest does:
    // the announcement is the only thing that gives the recipient a bubble to
    // accept from. This path used to issue only the protocol SendFile, so the
    // recipient's internal service held an offer no UI ever surfaced and the
    // sender waited forever on an accept nobody could click.
    await announceTransfer(intent.transfer, false);

    const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();

    // Build FileSource - support both direct path and PickFileRef
    let source: FileSource;
    if (intent.pickFileRequestId) {
      source = { PickFileRef: { pick_file_request_id: intent.pickFileRequestId } };
    } else {
      source = { Path: intent.filePath };
    }

    const request: { SendFile: { request_id: `${string}-${string}-${string}-${string}-${string}`; source: { Path: string; } | { PickFileRef: { pick_file_request_id: string; }; }; cid: string; peer_cid: string | null; chunk_size: null; transfer_type: string; }; } = {
      SendFile: {
        request_id: requestId,
        source,
        cid: intent.cid,
        peer_cid: intent.peerCid,
        chunk_size: null, // Use default
        transfer_type: 'FileTransfer',
      },
    };

    debugLog('FileTransferIO', 'FileTransferIO: Sending SendFile request', {
      requestId,
      source,
      cid: intent.cid,
      peerCid: intent.peerCid,
      transferId: intent.transferId,
    });

    // The send runs inside the ack promise so a send failure settles the same
    // promise: created side by side, a failed send left the ack orphaned to
    // reject unheard at its timeout, leaking the listener for 30s.
    // Before the send: the WebSocket is ordered, so no tick can precede it.
    this.noteOutgoingStream(requestId, intent.transferId);
    await awaitSendFileAck(requestId, () => websocketService.sendMessage(request));
    intent.transfer.tickRequestId = requestId;
  }
}
