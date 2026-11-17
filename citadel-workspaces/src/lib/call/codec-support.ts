/**
 * Codec selection for calls.
 *
 * Encoding happens in the browser through WebCodecs rather than in Rust/WASM.
 * That is not a convenience: WebCodecs is the only path that reaches the
 * platform's hardware encoders, and this app's WASM build has neither threads
 * nor SIMD, so a software codec compiled into it could not hold realtime at
 * 720p while sharing a thread with the transport.
 */

import type { CallCodecCapabilities } from '@/types/p2p-commands';
import { hasTrackTransforms } from './track-transforms';

/** Opus. There is no serious alternative for interactive voice. */
export const AUDIO_CODEC: "opus" = 'opus';

/** 48 kHz mono at 32 kbps: the standard operating point for speech. */
export const AUDIO_SAMPLE_RATE: number = 48_000;
export const AUDIO_CHANNELS: number = 1;
export const AUDIO_BITRATE: number = 32_000;

/**
 * Video codecs in preference order.
 *
 * AV1 first for quality per bit and for its screen-content tools, VP9 as the
 * realistic workhorse, H.264 baseline as the floor that hardware has encoded
 * since roughly 2012. All three are decodable far more widely than they are
 * encodable, which is why negotiation is done on the receiver's DECODE list.
 */
export const VIDEO_CODEC_PREFERENCE: readonly ["av01.0.05M.08", "vp09.00.31.08", "avc1.42E01F"] = [
  'av01.0.05M.08',
  'vp09.00.31.08',
  'avc1.42E01F',
] as const;

export type VideoCodec = (typeof VIDEO_CODEC_PREFERENCE)[number];

export interface VideoProfile {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
}

/** 720p30 at 1.2 Mbps for the main tile. */
export const VIDEO_PROFILE_MAIN: VideoProfile = {
  width: 1280,
  height: 720,
  framerate: 30,
  bitrate: 1_200_000,
};

/**
 * 320x180 at 150 kbps for everyone who is not the active speaker.
 *
 * Sending only the main tier to every peer is what makes a mesh call collapse:
 * uplink grows with participant count. The thumbnail tier keeps an eight-person
 * call inside a normal home uplink.
 */
export const VIDEO_PROFILE_THUMBNAIL: VideoProfile = {
  width: 320,
  height: 180,
  framerate: 15,
  bitrate: 150_000,
};

/**
 * A shared screen: bigger, slower, and given more bits than a face.
 *
 * A screen is read, not watched. Text at 720p is unreadable, so the resolution
 * goes up; almost every frame is identical to the last, so the frame rate comes
 * down and costs nothing. The bitrate is higher than the camera's because the
 * frames that DO change — a scroll, a slide, a window moving — change
 * everywhere at once, and a screen share that turns to mush exactly when
 * somebody scrolls is a screen share nobody trusts.
 */
export const VIDEO_PROFILE_SCREEN: VideoProfile = {
  width: 1920,
  height: 1080,
  framerate: 8,
  bitrate: 2_500_000,
};

export interface MediaCapabilityReport {
  /** False when this browser cannot do calls at all. */
  supported: boolean;
  audio: boolean;
  video: boolean;
  /** Reason to show the user when unsupported — never just a disabled button. */
  reason?: string;
}

function hasWebCodecs(): boolean {
  return (
    typeof globalThis.AudioEncoder === 'function' &&
    typeof globalThis.AudioDecoder === 'function' &&
    typeof globalThis.VideoEncoder === 'function' &&
    typeof globalThis.VideoDecoder === 'function'
  );
}

/**
 * What this browser can actually do, asked rather than assumed.
 *
 * `isConfigSupported` is the only honest answer: codec support varies by
 * browser, by platform, and by whether hardware is present. A hardcoded list
 * would show a call button that fails at the moment the user presses it.
 */
export async function probeMediaCapabilities(): Promise<MediaCapabilityReport> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      audio: false,
      video: false,
      reason: 'This browser cannot access a microphone or camera.',
    };
  }

  if (!hasWebCodecs()) {
    return {
      supported: false,
      audio: false,
      video: false,
      reason: 'This browser does not support WebCodecs, which calls require.',
    };
  }

  // The pipeline moves samples through Insertable Streams at both ends.
  // Without them the probe reported supported and no audio ever flowed.
  if (!hasTrackTransforms()) {
    return {
      supported: false,
      audio: false,
      video: false,
      reason: 'This browser cannot process media tracks, which calls require.',
    };
  }

  const audio: boolean = await supportsAudioEncode();
  const video: boolean = (await supportedVideoEncoders()).length > 0;

  if (!audio) {
    // Video-only calling is not a product: a call is a conversation.
    return {
      supported: false,
      audio: false,
      video,
      reason: 'This browser cannot encode Opus audio, which calls require.',
    };
  }

  return { supported: true, audio, video };
}

async function supportsAudioEncode(): Promise<boolean> {
  try {
    const { supported } = await AudioEncoder.isConfigSupported({
      codec: AUDIO_CODEC,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: AUDIO_BITRATE,
    });
    return supported === true;
  } catch {
    return false;
  }
}

/** Video codecs this browser can ENCODE, in preference order, with hw hints. */
export async function supportedVideoEncoders(): Promise<
  Array<{ codec: VideoCodec; hardware: boolean }>
> {
  const results: Array<{ codec: VideoCodec; hardware: boolean }> = [];

  for (const codec of VIDEO_CODEC_PREFERENCE) {
    const hardware: boolean = await encoderSupported(codec, 'prefer-hardware');
    if (hardware) {
      results.push({ codec, hardware: true });
      continue;
    }
    if (await encoderSupported(codec, 'no-preference')) {
      results.push({ codec, hardware: false });
    }
  }

  return results;
}

async function encoderSupported(
  codec: VideoCodec,
  hardwareAcceleration: HardwareAcceleration,
): Promise<boolean> {
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: VIDEO_PROFILE_MAIN.width,
      height: VIDEO_PROFILE_MAIN.height,
      bitrate: VIDEO_PROFILE_MAIN.bitrate,
      framerate: VIDEO_PROFILE_MAIN.framerate,
      hardwareAcceleration,
      latencyMode: 'realtime',
    });
    return supported === true;
  } catch {
    // A codec string this browser does not parse throws rather than returning
    // false, and that is still just "no".
    return false;
  }
}

/** Video codecs this browser can DECODE — the list sent to peers. */
export async function supportedVideoDecoders(): Promise<
  Array<{ codec: string; hardware: boolean; maxHeight: number }>
> {
  const results: Array<{ codec: string; hardware: boolean; maxHeight: number }> = [];

  for (const codec of VIDEO_CODEC_PREFERENCE) {
    try {
      const { supported } = await VideoDecoder.isConfigSupported({ codec });
      if (supported === true) {
        results.push({ codec, hardware: false, maxHeight: VIDEO_PROFILE_MAIN.height });
      }
    } catch {
      // Unparseable codec string; skip.
    }
  }

  return results;
}

/** This browser's decode capabilities, as advertised in call signalling. */
export async function localCapabilities(): Promise<CallCodecCapabilities> {
  return {
    audio: (await supportsAudioEncode()) ? [AUDIO_CODEC] : [],
    video: await supportedVideoDecoders(),
  };
}
