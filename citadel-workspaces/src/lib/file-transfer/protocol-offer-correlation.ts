/**
 * Joining the two halves of an incoming transfer.
 *
 * A transfer arrives as two independent events, and they name it differently:
 *
 *   - the BYTES come over the protocol's own SendFile, which raises a
 *     `FileTransferRequestNotification` carrying a numeric `object_id`;
 *   - the BUBBLE comes as an ordinary P2P message carrying a
 *     `FileTransferRequest` layer with a `transfer_id` — a `crypto.randomUUID()`
 *     minted by the sender.
 *
 * Accept and decline go back over the PROTOCOL, so they must name the
 * `object_id`. `registerTransferMapping` was written to bridge the two id
 * spaces and had no callers, so nothing ever populated the map — and the accept
 * path passed the UUID straight to `BigInt()`, which throws `SyntaxError`
 * synchronously while building the request. `RespondFileTransfer` was therefore
 * never sent for ANY incoming transfer: the protocol offer was never accepted,
 * the bytes never landed, and the user saw "Failed to accept file" with a raw
 * BigInt parse error as the description.
 *
 * The two events race, so correlation has to work in both orders. There is no
 * shared id to join on — that is the whole problem — so we join on what both
 * sides independently describe: the sender, the file name and the exact byte
 * size.
 */

import { debugLog } from '@/lib/debug-config';

/** What the protocol notification tells us, before any bubble has arrived. */
interface PendingProtocolOffer {
  objectId: string;
  senderCid: string;
  fileName: string;
  fileSize: number;
  seenAt: number;
}

/**
 * A protocol offer is only useful while its message half might still arrive.
 * Beyond this we drop it rather than let an unbounded map accumulate one entry
 * per transfer for the lifetime of the tab.
 */
const OFFER_TTL_MS: number = 5 * 60 * 1000;

/** Same sender, same name, same exact size. */
function matches(
  offer: PendingProtocolOffer,
  senderCid: string,
  fileName: string,
  fileSize: number
): boolean {
  return offer.senderCid === senderCid && offer.fileName === fileName && offer.fileSize === fileSize;
}

export class ProtocolOfferCorrelator {
  private pending: PendingProtocolOffer[] = [];

  /** Buffered message-half arrivals, for when the bubble beats the bytes. */
  private awaitingBytes: Array<{
    transferId: string;
    senderCid: string;
    fileName: string;
    fileSize: number;
    seenAt: number;
  }> = [];

  /**
   * `isOpen` says whether a held message half's transfer can still be accepted.
   * Offers of the same file (same sender, name and size) pair in arrival order,
   * so a half whose protocol offer never came -- stalled, then cancelled or
   * expired -- used to take the NEXT offer's object id, and that live offer
   * could never be accepted ("not announced over the protocol yet", live).
   */
  constructor(
    private readonly register: (transferId: string, objectId: string) => void,
    private readonly isOpen: (transferId: string) => boolean,
  ) {}

  private prune(now: number): void {
    this.pending = this.pending.filter((o) => now - o.seenAt < OFFER_TTL_MS);
    this.awaitingBytes = this.awaitingBytes.filter((a) => now - a.seenAt < OFFER_TTL_MS);
  }

  /** The protocol half arrived. */
  noteProtocolOffer(objectId: string, senderCid: string, fileName: string, fileSize: number): void {
    const now: number = Date.now();
    this.prune(now);

    this.awaitingBytes = this.awaitingBytes.filter((a) => this.isOpen(a.transferId));
    const waitingIndex: number = this.awaitingBytes.findIndex((a) =>
      matches({ objectId, senderCid, fileName, fileSize, seenAt: now }, a.senderCid, a.fileName, a.fileSize)
    );
    if (waitingIndex !== -1) {
      const [waiting] = this.awaitingBytes.splice(waitingIndex, 1);
      this.register(waiting.transferId, objectId);
      debugLog('ProtocolOfferCorrelator', 'joined (bubble first)', {
        transferId: waiting.transferId,
        objectId,
      });
      return;
    }

    this.pending.push({ objectId, senderCid, fileName, fileSize, seenAt: now });
  }

  /** The message half arrived. Returns true when the pair is now joined. */
  noteMessageOffer(
    transferId: string,
    senderCid: string,
    fileName: string,
    fileSize: number
  ): boolean {
    const now: number = Date.now();
    this.prune(now);

    const index: number = this.pending.findIndex((o) => matches(o, senderCid, fileName, fileSize));
    if (index !== -1) {
      const [offer] = this.pending.splice(index, 1);
      this.register(transferId, offer.objectId);
      debugLog('ProtocolOfferCorrelator', 'joined (bytes first)', { transferId, objectId: offer.objectId });
      return true;
    }

    // The bytes have not been announced yet. Hold the message half rather than
    // dropping it: on a slow link the notification can trail the bubble, and a
    // transfer that cannot be accepted is indistinguishable to the user from one
    // that never arrived.
    this.awaitingBytes.push({ transferId, senderCid, fileName, fileSize, seenAt: now });
    return false;
  }

  clear(): void {
    this.pending = [];
    this.awaitingBytes = [];
  }
}
