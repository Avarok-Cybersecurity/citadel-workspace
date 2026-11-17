/**
 * The contract between a CallSession and whoever owns it.
 *
 * Its own file because the session is at the 250-line limit and this is the
 * cohesive piece to lift: it is the session's interface to React, not part of
 * how the session works.
 */
import type { CaptureFailure } from './media-capture';
import type { WireFrame } from './frame-codec';

export interface CallSessionCallbacks {
  /** Called for every encoded frame, to be fanned out to participants. */
  onFrame: (frame: WireFrame) => void;
  /** Called when a peer's streams change, so the UI can re-render tiles. */
  onStreamsChanged: () => void;
  /**
   * Called when this person starts or stops speaking. Only on a CHANGE.
   *
   * Local only. Remote levels would need the audio in `getRemoteAudioStreams`
   * analysed per peer, or a signal on the wire -- and a per-frame signal is the
   * traffic pattern the annotation rate limiter exists to prevent.
   */
  onSpeakingChanged: (speaking: boolean) => void;
  /** Called when capture fails, with a reason the user can act on. */
  onCaptureFailed: (failure: CaptureFailure) => void;
  /** Called when a peer's stream can only recover via a keyframe from them. */
  onNeedKeyframe: (peerCid: bigint, track: number) => void;
  /**
   * A live capture device stopped mid-call — unplugged, or revoked by the OS.
   *
   * Nothing used to listen for this. The track ended, the pump's reader loop
   * returned silently, and every part of the UI went on insisting the call was
   * healthy: the mic button still read unmuted, peers still saw an unmuted
   * tile, and heartbeats kept flowing so the liveness watchdog never noticed. A
   * silently dead call that looked fine, with no recovery but Leave and re-dial
   * and nothing saying so.
   */
  onTrackEnded: (kind: 'audio' | 'video') => void;
}
