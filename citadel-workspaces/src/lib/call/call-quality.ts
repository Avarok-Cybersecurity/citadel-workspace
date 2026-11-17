/**
 * Per-participant connection quality, derived from gap reports.
 *
 * The tiles have always been able to show a degrading connection — icon,
 * screen-reader text and tooltip — but nothing ever computed it, so every
 * participant read as "good" no matter how badly their stream was arriving.
 *
 * Gaps are the honest signal available without a protocol change: the transport
 * already reports MediaGapNotification per peer whenever frames were lost and
 * the jitter buffer moved past them. Frequency over a rolling window is what
 * separates "one hiccup" from "this link is failing".
 */

import type { ConnectionQuality } from '@/components/call/ParticipantTile';

/**
 * How far back gaps are counted.
 *
 * Ten seconds is long enough that a single lost frame does not light up a
 * warning, and short enough that recovery is visible while the user is still
 * looking at the tile.
 */
export const QUALITY_WINDOW_MS: number = 10_000;

/** Gaps within the window before a link stops being reported as good. */
export const FAIR_THRESHOLD: number = 2;
/** Gaps within the window that mean the picture is visibly breaking up. */
export const POOR_THRESHOLD: number = 6;

/**
 * Silence before a participant is reported as lost.
 *
 * Deliberately longer than the gap thresholds: no frames at all is either a
 * dead link or a participant who muted and turned their camera off, and the
 * second must not be shown as a fault.
 */
export const LOST_SILENCE_MS: number = 12_000;

interface PeerQualityState {
  /** Timestamps of recent gaps, oldest first. */
  gaps: number[];
  lastFrameAt: number;
}

export class CallQualityTracker {
  private readonly peers: Map<bigint, PeerQualityState> = new Map<bigint, PeerQualityState>();

  /** A frame arrived from this peer. */
  recordFrame(cid: bigint, now: number): void {
    const state: PeerQualityState | undefined = this.peers.get(cid);
    if (state) {
      state.lastFrameAt = now;
      return;
    }
    this.peers.set(cid, { gaps: [], lastFrameAt: now });
  }

  /** The transport reported lost frames from this peer. */
  recordGap(cid: bigint, now: number): void {
    const state: PeerQualityState = this.peers.get(cid) ?? { gaps: [], lastFrameAt: now };
    state.gaps.push(now);
    this.peers.set(cid, state);
  }

  forget(cid: bigint): void {
    this.peers.delete(cid);
  }

  clear(): void {
    this.peers.clear();
  }

  /**
   * Quality per participant right now.
   *
   * Peers with no history are absent rather than reported good: a call that has
   * not started carrying media yet should say nothing, not claim a healthy
   * connection it has no evidence for.
   */
  snapshot(now: number): Map<bigint, ConnectionQuality> {
    const result: Map<bigint, ConnectionQuality> = new Map<bigint, ConnectionQuality>();

    for (const [cid, state] of this.peers) {
      // Pruned on read rather than on a timer: the window only matters when
      // someone asks, and a timer would keep a call awake to discard numbers.
      state.gaps = state.gaps.filter((at) => now - at < QUALITY_WINDOW_MS);

      if (now - state.lastFrameAt >= LOST_SILENCE_MS) {
        result.set(cid, 'lost');
        continue;
      }
      if (state.gaps.length >= POOR_THRESHOLD) {
        result.set(cid, 'poor');
        continue;
      }
      if (state.gaps.length >= FAIR_THRESHOLD) {
        result.set(cid, 'fair');
        continue;
      }
      result.set(cid, 'good');
    }

    return result;
  }
}
