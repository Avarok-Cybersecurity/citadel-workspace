/**
 * The receiving half of a call: one PeerReceiver per participant, plus the
 * bookkeeping of which codec each peer said it would send.
 *
 * Split from CallSession so the session owns capture and encoding while this
 * owns decode — the two halves share nothing but the stream-change callback.
 */

import { PeerReceiver } from './peer-receiver';
import type { WireFrame } from './frame-codec';
import { CallQualityTracker } from './call-quality';
import type { ConnectionQuality } from '@/components/call/ParticipantTile';

export interface ReceiverPoolCallbacks {
  /** Called when a peer's streams change, so the UI can re-render tiles. */
  onStreamsChanged: () => void;
  /** Called when a peer's stream can only recover via a keyframe from them. */
  onNeedKeyframe: (peerCid: bigint, track: number) => void;
  /** Our own send codec, the decode guess for peers that announced nothing. */
  fallbackCodec: () => string;
}

export class ReceiverPool {
  /**
   * Connection quality, tracked here because this is where per-peer frames and
   * gaps converge. Anywhere else would have to be told about both again.
   */
  private readonly quality: CallQualityTracker = new CallQualityTracker();

  private readonly receivers: Map<bigint, PeerReceiver> = new Map<bigint, PeerReceiver>();
  /** What each peer told us it will SEND, so decoders match what arrives. */
  private readonly peerReceiveCodecs: Map<bigint, string> = new Map<bigint, string>();

  constructor(private readonly callbacks: ReceiverPoolCallbacks) {}

  videoStreams(): Map<bigint, MediaStream> {
    const streams: Map<bigint, MediaStream> = new Map<bigint, MediaStream>();
    for (const [cid, receiver] of this.receivers) {
      const stream: MediaStream | null = receiver.getVideoStream();
      if (stream) streams.set(cid, stream);
    }
    return streams;
  }

  /** Every peer currently sharing a screen, by CID. */
  screenStreams(): Map<bigint, MediaStream> {
    const streams: Map<bigint, MediaStream> = new Map();
    for (const [cid, receiver] of this.receivers) {
      const stream: MediaStream | null = receiver.getScreenStream();
      if (stream) streams.set(cid, stream);
    }
    return streams;
  }

  audioStreams(): Map<bigint, MediaStream> {
    const streams: Map<bigint, MediaStream> = new Map<bigint, MediaStream>();
    for (const [cid, receiver] of this.receivers) {
      const stream: MediaStream | null = receiver.getAudioStream();
      if (stream) streams.set(cid, stream);
    }
    return streams;
  }

  /** Record what a peer will send us, rebuilding its decoder on a change. */
  setReceiveCodec(peerCid: bigint, codec: string): void {
    if (this.peerReceiveCodecs.get(peerCid) === codec) return;
    this.peerReceiveCodecs.set(peerCid, codec);
    const receiver: PeerReceiver | undefined = this.receivers.get(peerCid);
    if (receiver) {
      receiver.close();
      this.receivers.delete(peerCid);
      this.callbacks.onStreamsChanged();
    }
  }

  /** Route one received frame to the peer it came from. */
  accept(peerCid: bigint, frame: WireFrame): void {
    const receiver: PeerReceiver = this.receiverFor(peerCid);
    const hadVideo: boolean = receiver.getVideoStream() !== null;
    const hadAudio: boolean = receiver.getAudioStream() !== null;
    const hadScreen: boolean = receiver.getScreenStream() !== null;
    receiver.accept(frame);
    this.quality.recordFrame(peerCid, Date.now());
    // Only re-render when a stream actually appears; a notify per frame would
    // re-render the whole call surface sixty times a second. Audio counts too:
    // an audio-only call's first frame is what tells the UI to attach a sink.
    const videoAppeared: boolean = !hadVideo && receiver.getVideoStream() !== null;
    const audioAppeared: boolean = !hadAudio && receiver.getAudioStream() !== null;
    // Screen too. `acceptScreen` builds a SEPARATE sink reachable only through
    // getScreenStream(), so the two checks above cannot see a share appear --
    // and the call context is a memo keyed on the version this notify bumps.
    // Without it a peer's share stayed invisible until some unrelated
    // transition happened to rebuild the context: a mic toggle, a participant
    // change, a quality re-classification. In a quiet call, potentially never.
    const screenAppeared: boolean = !hadScreen && receiver.getScreenStream() !== null;
    if (videoAppeared || audioAppeared || screenAppeared) {
      this.callbacks.onStreamsChanged();
    }
  }

  gap(peerCid: bigint, track: number, isVideo: boolean): void {
    this.receivers.get(peerCid)?.handleGap(track, isVideo);
    // Recorded even when no receiver exists for the peer yet: a gap arriving
    // before the first frame is still evidence about that link.
    this.quality.recordGap(peerCid, Date.now());
  }

  /**
   * How each peer's link is currently doing.
   *
   * `now` is passed in rather than read here so the caller controls the clock —
   * the thresholds are time-based, and a tracker that reads its own clock
   * cannot be tested without waiting in real time.
   */
  connectionQuality(now: number): Map<bigint, ConnectionQuality> {
    return this.quality.snapshot(now);
  }

  /** Release one peer's decoders when they leave a group call. */
  remove(peerCid: bigint): void {
    this.peerReceiveCodecs.delete(peerCid);
    // Before the early return below: a peer can accumulate gap history without
    // ever having a receiver — gaps are recorded from the first one, receivers
    // only appear with the first decodable frame. Forgetting after the return
    // would leave that history behind for a peer who left, and hand it back to
    // them stale if they rejoined.
    this.quality.forget(peerCid);
    const receiver: PeerReceiver | undefined = this.receivers.get(peerCid);
    if (!receiver) return;
    receiver.close();
    this.receivers.delete(peerCid);
    this.callbacks.onStreamsChanged();
  }

  closeAll(): void {
    for (const receiver of this.receivers.values()) receiver.close();
    this.receivers.clear();
    this.quality.clear();
  }

  private receiverFor(peerCid: bigint): PeerReceiver {
    const existing: PeerReceiver | undefined = this.receivers.get(peerCid);
    if (existing) return existing;

    const receiver: PeerReceiver = new PeerReceiver({
      // What the PEER sends, not what we send: the two only coincide when both
      // machines happen to share a best encoder — true on one dev box, false
      // across real hardware.
      videoCodec: this.peerReceiveCodecs.get(peerCid) ?? this.callbacks.fallbackCodec(),
      onNeedKeyframe: (track) => this.callbacks.onNeedKeyframe(peerCid, track),
    });
    this.receivers.set(peerCid, receiver);
    return receiver;
  }
}
