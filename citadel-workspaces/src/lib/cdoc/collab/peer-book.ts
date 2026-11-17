/**
 * The peers present in a document: each one's latest awareness record, its rectangles on this
 * replica's pages, and when it was last heard. Keyed by the session that relayed the record and
 * then by the replica the record names (`PeerView.client`): two tabs of one account are two
 * carets, and a client id is only ever the sender's own claim, so one session can neither
 * replace nor crowd out another's carets. Each session keeps at most `maxPerSender` carets; a
 * new one beyond that drops the one heard least recently.
 *
 * The rectangles are this replica's, so they go stale when this replica repaints (PeerOverlay's
 * rule: after every `pages` event). A repaint moves nothing before its first repainted page, so
 * `remap` re-derives only the carets at or after it, and every one not yet placed.
 */
import type { PageRect, PeerView } from '../editor/controller';
import type { PeerPresence } from '../editor/peer-overlay';
import type { PeerIdentity } from './ports';

interface HeardPeer {
  readonly fromCid: bigint;
  readonly record: Uint8Array;
  view: PeerView;
  readonly heardAt: number;
}

export class PeerBook {
  private readonly senders: Map<bigint, Map<bigint, HeardPeer>> = new Map<bigint, Map<bigint, HeardPeer>>();

  constructor(private readonly identify: PeerIdentity, private readonly expiryMs: number, private readonly maxPerSender: number) {
    if (!Number.isInteger(maxPerSender) || maxPerSender < 1) throw new Error(`a session must be allowed at least one caret, not ${maxPerSender}`);
  }

  hear(fromCid: bigint, record: Uint8Array, view: PeerView, now: number): void {
    const own: Map<bigint, HeardPeer> = this.senders.get(fromCid) ?? new Map<bigint, HeardPeer>();
    this.senders.set(fromCid, own);
    // Re-inserted, so iteration order is least recently heard first.
    own.delete(view.client);
    own.set(view.client, { fromCid, record, view, heardAt: now });
    for (const client of own.keys()) {
      if (own.size <= this.maxPerSender) break;
      own.delete(client);
    }
  }

  /** Re-derives the carets a repaint from `fromPage` on can have moved (null: every one). */
  async remap(viewOf: (record: Uint8Array) => Promise<PeerView>, fromPage: number | null): Promise<void> {
    for (const peer of this.all()) {
      if (fromPage === null || mayHaveMoved(peer.view, fromPage)) peer.view = await viewOf(peer.record);
    }
  }

  /** Forgets peers not heard from within `expiryMs`; true when any was forgotten. */
  expire(now: number): boolean {
    let forgot: boolean = false;
    for (const [fromCid, own] of this.senders) {
      for (const [client, peer] of own) {
        if (now - peer.heardAt >= this.expiryMs) {
          own.delete(client);
          forgot = true;
        }
      }
      if (own.size === 0) this.senders.delete(fromCid);
    }
    return forgot;
  }

  presences(): PeerPresence[] {
    return this.all().map((peer: HeardPeer): PeerPresence => {
      const who: ReturnType<PeerIdentity> = this.identify(peer.fromCid);
      return { name: who.name, color: who.color, view: peer.view };
    });
  }

  get size(): number {
    let size: number = 0;
    for (const own of this.senders.values()) size += own.size;
    return size;
  }

  private all(): HeardPeer[] {
    return [...this.senders.values()].flatMap((own: Map<bigint, HeardPeer>): HeardPeer[] => [...own.values()]);
  }
}

function mayHaveMoved(view: PeerView, fromPage: number): boolean {
  if (view.caret === null || view.caret.page >= fromPage) return true;
  return view.selectionRects.some((r: PageRect): boolean => r.page >= fromPage);
}
