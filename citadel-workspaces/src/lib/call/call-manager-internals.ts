/**
 * The narrow face of CallManager that its extracted collaborators operate on.
 *
 * Signal handling and media-session lifecycle live in their own modules purely
 * for size and testability; this interface is what keeps them honest — they
 * see exactly the state and effects they need, not the whole manager.
 */

import type { CallCodecCapabilities } from '@/types/p2p-commands';
import type { CallEvent, CallState } from './call-state';
import type { CallTransport } from './call-transport';
import type { PeerCodecBook } from './peer-codec-book';

/** Everything a caller must supply to construct a CallManager. */
export interface CallManagerOptions {
  transport: CallTransport;
  selfCid: bigint;
  capabilities: CallCodecCapabilities;
  /** Injected so tests are not at the mercy of a real clock. */
  now: () => number;
  /** Injected timer (returns a cancel), same reasoning as `now`. */
  schedule: (fn: () => void, delayMs: number) => () => void;
  onStateChanged: (state: CallState | null) => void;
  /** A peer's decoder is stuck and needs our encoder to produce a keyframe. */
  onKeyframeRequested: (track: number) => void;
  /** How this peer's stream is arriving HERE, to ride out on the next
   *  heartbeat so their encoder can adapt. Undefined until enough media has
   *  arrived to judge — no evidence must not read as a healthy link. */
  observedLink?: (cid: bigint) => 'good' | 'fair' | 'poor' | 'lost' | undefined;
  /** A peer told us how OUR stream is arriving for them. */
  onLinkReported?: (link: 'good' | 'fair' | 'poor' | 'lost') => void;
  /** Names a peer the wire identified only by CID. Injected like `now`: the
   *  roster lives outside this layer, and tests need one they control. */
  resolvePeerName: (cid: bigint) => string;
}

export interface CallManagerInternals {
  readonly transport: CallTransport;
  /** Group invites carry the full roster, which includes us; this is how the
   *  signal handler knows which entry not to treat as a peer. */
  readonly selfCid: bigint;
  readonly capabilities: CallCodecCapabilities;
  readonly codecs: PeerCodecBook;
  /** Peers with an open media session, so close is exact. */
  readonly openSessions: Set<bigint>;
  /**
   * Opens that have started and not finished, by peer.
   *
   * `openSessions` records COMPLETION, so it cannot stop a second attempt that
   * begins while the first is still in the air — and two do. `accept()` opens a
   * session for every peer already answered, and the `CallAccept` handler opens
   * one for the peer that just answered; in a group call those two run for the
   * same peer at the same time. The service rejects the second with "a media
   * open or teardown is already in progress with this peer; retry shortly",
   * which CI reported as the call failing.
   */
  readonly openingSessions: Map<bigint, Promise<void>>;
  /** See CallManagerOptions.now. */
  now(): number;
  /** See CallManagerOptions.schedule. */
  schedule(fn: () => void, delayMs: number): () => void;
  getState(): CallState | null;
  apply(event: CallEvent): void;
  /** A peer's decoder is stuck and needs our encoder to produce a keyframe. */
  keyframeRequested(track: number): void;
  /** See CallManagerOptions.observedLink. */
  observedLink(cid: bigint): 'good' | 'fair' | 'poor' | 'lost' | undefined;
  /** See CallManagerOptions.onLinkReported. */
  linkReported(link: 'good' | 'fair' | 'poor' | 'lost'): void;
  /** An inbound signal for the current call arrived from this peer. */
  peerSeen(cid: bigint): void;
  /** Names a peer the wire identified only by CID. See CallManagerOptions. */
  resolvePeerName(cid: bigint): string;
}
