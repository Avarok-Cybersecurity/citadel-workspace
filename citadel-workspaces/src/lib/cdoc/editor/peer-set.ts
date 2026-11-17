/**
 * The PeerOverlay the controller exposes, as state the page view draws: the latest set of
 * peers, replaced whole by each setPeers, and one change signal for the view to repaint its
 * overlays from. Drawing is the view's (page-view/overlay-painter.ts); this holds no canvas.
 */
import type { PeerOverlay, PeerPresence } from './peer-overlay';

export class PeerSet implements PeerOverlay {
  private peers: readonly PeerPresence[] = [];
  private readonly listeners: Set<() => void> = new Set<() => void>();

  get current(): readonly PeerPresence[] {
    return this.peers;
  }

  setPeers(peers: readonly PeerPresence[]): void {
    const seen: Set<bigint> = new Set<bigint>();
    for (const p of peers) {
      if (seen.has(p.view.client)) throw new Error(`peer ${p.view.client} is listed twice`);
      seen.add(p.view.client);
    }
    this.peers = [...peers];
    this.changed();
  }

  clear(): void {
    this.peers = [];
    this.changed();
  }

  /** Called after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
