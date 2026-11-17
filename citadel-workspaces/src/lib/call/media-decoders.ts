/**
 * Decoder halves of the media pipeline. Split from media-pipeline so each side
 * stays under the file cap; the encoder half lives there.
 */
export interface VideoDecoderHandle {
  decode: (frame: WireFrame) => void;
  close: () => void;
  /** True once a keyframe has been seen and output is meaningful. */
  isPrimed: () => boolean;
}

/**
 * Decode video, holding back until a keyframe arrives.
 *
 * Feeding a decoder delta frames first produces a smeared, blocky picture that
 * slowly corrects itself. Showing nothing until the stream can actually be
 * decoded reads as "connecting"; showing corruption reads as "broken".
 */
import { AUDIO_CODEC, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from './codec-support';
import { canStartDecoding, frameToDecoderChunk, type WireFrame } from './frame-codec';
import type { DecoderChunkInit } from '@/lib/call/frame-codec';

/**
 * How long to wait before asking a peer for a keyframe again.
 *
 * While a decoder is un-primed EVERY arriving delta frame is undecodable, and
 * each one used to send a `CallKeyframeRequest` — a RELIABLE signal, on the same
 * chain `CallEnd` travels. At thirty frames a second that is thirty signals a
 * second, per track, per peer, for as long as it takes the far side to notice
 * and produce a keyframe. Which is at least a round trip plus an encode, so the
 * flood is guaranteed to happen every time a stream starts or a decoder resets.
 *
 * Half a second is longer than a round trip on any link worth calling on and
 * shorter than a person notices a frozen tile. Asking again matters — a request
 * can be lost, and then nothing else would ever ask.
 */
const KEYFRAME_REQUEST_INTERVAL_MS: number = 500;

export function createVideoDecoder(
  codec: string,
  onFrame: (frame: VideoFrame) => void,
  onError: (error: Error) => void,
  onNeedKeyframe: () => void,
  /** Injected so a test is not at the mercy of a real clock. */
  now: () => number = (): number => Date.now(),
): VideoDecoderHandle {
  let primed: boolean = false;
  /** When we last asked this peer for a keyframe; -Infinity means never. */
  let lastKeyframeRequestAt: number = -Infinity;

  /** Ask, but never more often than the interval above. */
  const askForKeyframe = (): void => {
    const at: number = now();
    if (at - lastKeyframeRequestAt < KEYFRAME_REQUEST_INTERVAL_MS) return;
    lastKeyframeRequestAt = at;
    onNeedKeyframe();
  };

  const decoder: VideoDecoder = new VideoDecoder({
    output: onFrame,
    error: (error): void => {
      // A decode error means the reference chain is broken; only a keyframe
      // recovers it, so ask rather than continuing to emit corruption.
      primed = false;
      // Not throttled: a decoder error is rare and is the one moment the peer
      // most needs to hear from us. The flood came from the per-frame path.
      lastKeyframeRequestAt = -Infinity;
      onNeedKeyframe();
      onError(error instanceof Error ? error : new Error(String(error)));
    },
  });

  decoder.configure({ codec, optimizeForLatency: true });

  return {
    decode(frame: WireFrame): void {
      // A fatal error closes the codec asynchronously; a frame can race that
      // callback, and decode() on a closed codec throws out of the caller's
      // event handler. The owner rebuilds the decoder — this just stays quiet.
      if (decoder.state === 'closed') return;
      if (!primed) {
        if (!canStartDecoding(frame)) {
          // Rate-limited: every frame arriving before the keyframe is
          // undecodable, and each one used to send a reliable signal.
          askForKeyframe();
          return;
        }
        primed = true;
      }
      const init: DecoderChunkInit = frameToDecoderChunk(frame);
      decoder.decode(new EncodedVideoChunk(init));
    },
    close(): void {
      if (decoder.state !== 'closed') decoder.close();
    },
    isPrimed: () => primed,
  };
}

export interface AudioDecoderHandle {
  decode: (frame: WireFrame) => void;
  close: () => void;
}

export function createAudioDecoder(
  onData: (data: AudioData) => void,
  onError: (error: Error) => void,
): AudioDecoderHandle {
  const decoder: AudioDecoder = new AudioDecoder({
    output: onData,
    error: (error): void => onError(error instanceof Error ? error : new Error(String(error))),
  });

  decoder.configure({
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
  });

  return {
    decode(frame: WireFrame): void {
      // Same closed-codec race as the video decoder; see above.
      if (decoder.state === 'closed') return;
      decoder.decode(new EncodedAudioChunk(frameToDecoderChunk(frame)));
    },
    close(): void {
      if (decoder.state !== 'closed') decoder.close();
    },
  };
}
