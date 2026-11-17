/**
 * The outbound half of a call: which codec we send, the encoders that produce
 * frames, and the congestion state that decides what to drop.
 *
 * Split out of `CallSession`, which owns the call's lifecycle (capture, the
 * receiver pool, teardown). These change for different reasons — the send codec
 * is renegotiated when peers answer, the lifecycle when the user hangs up — and
 * keeping the encoder state here means `close()` has one obvious place to
 * release it.
 */

import { CALL_TRACK_SCREEN } from '@/types/p2p-commands';
import type { VideoQuality } from './video-quality';
import { allowsAdaptation, cameraProfileFor, screenProfileFor } from './video-quality-profiles';
import {
  createAudioEncoder,
  createVideoEncoder,
  type AudioEncoderHandle,
  type VideoEncoderHandle,
} from './media-pipeline';
import {
  INITIAL_CONGESTION,
  applyReport,
  shouldDropFrame,
  type CongestionState,
  type LinkVerdict,
} from './congestion';
import type { VideoCodec } from './codec-support';
import { negotiateGroupVideoCodec } from './codec-negotiation';
import type { WireFrame } from './frame-codec';
import { debugLog } from '@/lib/debug-config';

export class SendEncoder {
  private videoEncoder: VideoEncoderHandle | null = null;
  private audioEncoder: AudioEncoderHandle | null = null;
  /** Built on the first shared-screen frame; see encodeScreen. */
  private screenEncoder: VideoEncoderHandle | null = null;
  /** The ceiling this person asked for; see lib/call/video-quality. */
  private quality: VideoQuality = 'auto';
  private congestion: CongestionState = INITIAL_CONGESTION;
  private codec: VideoCodec | null = null;
  /** Our encode capabilities, probed once at start and reused to renegotiate. */
  private encoders: Array<{ codec: VideoCodec; hardware: boolean }> = [];

  constructor(private readonly onFrame: (frame: WireFrame) => void) {}

  /** Adopt the probe result and the opening codec choice. */
  configure(encoders: Array<{ codec: VideoCodec; hardware: boolean }>, codec: VideoCodec | null): void {
    this.encoders = encoders;
    this.codec = codec;
  }

  getCodec(): VideoCodec | null { return this.codec; }
  getCongestion(): CongestionState { return this.congestion; }

  /**
   * Re-pick the send codec now that peers have advertised what they decode.
   *
   * Returns true when the codec changed, in which case the caller must announce
   * the new codec to peers — their decoders are configured from what we say we
   * send, and a silent switch is a permanently black tile on their side.
   */
  renegotiate(
    peerDecoderLists: Array<Array<{ codec: string; hardware: boolean; maxHeight: number }>>,
  ): boolean {
    if (this.encoders.length === 0 || peerDecoderLists.length === 0) return false;
    const next: "av01.0.05M.08" | "vp09.00.31.08" | "avc1.42E01F" | null = negotiateGroupVideoCodec(this.encoders, peerDecoderLists);
    if (next === this.codec) return false;
    // The encoder is rebuilt lazily by the next frame; closing it here is what
    // makes that frame create one with the new codec — and it starts with a
    // keyframe, so the far side can decode from the first frame.
    this.videoEncoder?.close();
    this.videoEncoder = null;
    this.codec = next;
    return true;
  }

  /**
   * Change the quality ceiling mid-call.
   *
   * Both encoders are dropped rather than reconfigured: `VideoEncoder.configure`
   * mid-stream is allowed but the decoders on the far side are configured for
   * what they were sent, and a resolution change without a keyframe is a
   * corrupt picture until the next one. A rebuilt encoder starts with a
   * keyframe, which is exactly the recovery this needs.
   */
  setQuality(quality: VideoQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.videoEncoder?.close();
    this.videoEncoder = null;
    this.screenEncoder?.close();
    this.screenEncoder = null;
  }

  getQuality(): VideoQuality { return this.quality; }

  encodeVideo(frame: VideoFrame, isKeyframe: boolean): void {
    if (!this.codec) {
      frame.close();
      return;
    }
    if (!this.videoEncoder) {
      const chosen: "av01.0.05M.08" | "vp09.00.31.08" | "avc1.42E01F" = this.codec;
      // The probe's verdict for THIS codec decides the acceleration mode; see
      // createVideoEncoder for why assuming hardware kills the whole call.
      const hardware: boolean = this.encoders.find((e): boolean => e.codec === chosen)?.hardware ?? false;
      this.videoEncoder = createVideoEncoder(
        chosen,
        false,
        hardware,
        this.onFrame,
        // Drop the handle so the next frame rebuilds, as the decoder does: a
        // closed codec makes encode() throw out of the capture pump, killing it.
        (error) => { debugLog('Call', 'video encode error', error); this.videoEncoder = null; },
        undefined,
        cameraProfileFor(this.quality),
      );
    }

    // Dropped BEFORE encoding, because the cheapest frame is the one never
    // encoded — and a frame dropped here costs nothing downstream.
    if (shouldDropFrame(this.congestion, isKeyframe, this.videoEncoder.queueSize())) {
      frame.close();
      return;
    }

    this.videoEncoder.encode(frame, this.congestion);
    frame.close();
  }

  /**
   * A shared-screen frame, on its own encoder.
   *
   * Separate from `encodeVideo` because the two run at different resolutions and
   * frame rates and must not share congestion behaviour: the camera may be
   * dropped to keep a call alive, and dropping the screen instead of the face
   * is usually the wrong trade -- the screen is what everyone is looking at.
   * Screen frames are therefore never dropped here; the encoder's own queue
   * handles overload by producing fewer frames rather than by discarding ones
   * already made.
   */
  encodeScreen(frame: VideoFrame, isKeyframe: boolean): void {
    if (!this.codec) {
      frame.close();
      return;
    }
    if (!this.screenEncoder) {
      const chosen: VideoCodec = this.codec;
      const hardware: boolean = this.encoders.find((e) => e.codec === chosen)?.hardware ?? false;
      this.screenEncoder = createVideoEncoder(
        chosen,
        false,
        hardware,
        this.onFrame,
        (error) => { debugLog('Call', 'screen encode error', error); this.screenEncoder = null; },
        { track: CALL_TRACK_SCREEN },
        screenProfileFor(this.quality),
      );
    }
    void isKeyframe;
    this.screenEncoder.encode(frame, this.congestion);
    frame.close();
  }

  /** Stop encoding the screen and release the codec. */
  closeScreen(): void {
    this.screenEncoder?.close();
    this.screenEncoder = null;
  }

  encodeAudio(data: AudioData): void {
    if (!this.audioEncoder) {
      // As above; audio has no fallback, so a dead encoder means silence.
      this.audioEncoder = createAudioEncoder(this.onFrame, (error) => {
        debugLog('Call', 'audio encode error', error); this.audioEncoder = null;
      });
    }
    this.audioEncoder.encode(data);
    data.close();
  }

  /** Force the next video frame to be a keyframe, at a peer's request. */
  requestKeyframe(): void { this.videoEncoder?.requestKeyframe(); }

  /**
   * How the far side says our stream is arriving.
   *
   * Until this was called, `congestion` never left rung 0 — so the encoder was
   * configured once at full quality and never reconfigured, and four of the
   * five ladder rungs were unreachable. The adaptation existed and never ran.
   */
  applyQualityReport(verdict: LinkVerdict): void {
    // Only while the person has left the ceiling to us.
    //
    // Somebody who picked "High detail" picked it; having the ladder quietly
    // step off it makes the setting a suggestion, which is the worst kind of
    // control because it looks like it did something. The congestion state is
    // still tracked -- it drives frame dropping, which is about latency rather
    // than picture -- but it no longer reconfigures away from a chosen profile.
    if (!allowsAdaptation(this.quality)) return;
    this.congestion = applyReport(this.congestion, verdict);
  }

  close(): void {
    this.videoEncoder?.close();
    this.videoEncoder = null;
    this.audioEncoder?.close();
    this.audioEncoder = null;
    this.closeScreen();
  }
}
