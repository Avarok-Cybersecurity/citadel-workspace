/**
 * The Insertable Streams constructors the call pipeline is built on.
 *
 * These live in one module because two separate questions depend on them and
 * used to answer independently: the capture/playback code needs the
 * CONSTRUCTOR, and the capability probe needs to know whether calling is
 * possible at all. The probe did not ask, so a browser with WebCodecs but
 * without these reported `supported: true` and then carried no audio in either
 * direction — capture logged a debug line and stopped, and the inbound sink
 * discarded every frame it was handed.
 */

export interface TrackProcessorCtor {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame | AudioData> };
}

export interface TrackGeneratorCtor {
  new (init: { kind: 'video' | 'audio' }): MediaStreamTrack & {
    writable: WritableStream<VideoFrame | AudioData>;
  };
}

export function trackProcessor(): TrackProcessorCtor | null {
  const ctor: TrackProcessorCtor | undefined = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  return typeof ctor === 'function' ? ctor : null;
}

export function trackGenerator(): TrackGeneratorCtor | null {
  const ctor: TrackGeneratorCtor | undefined = (globalThis as { MediaStreamTrackGenerator?: TrackGeneratorCtor })
    .MediaStreamTrackGenerator;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * Audio is the one media type with no fallback anywhere in the pipeline: video
 * has a canvas capture path and can degrade, audio simply does not exist
 * without both of these. A call is a conversation, so this gates calling
 * entirely rather than reporting a video-only call.
 */
export function hasTrackTransforms(): boolean {
  return trackProcessor() !== null && trackGenerator() !== null;
}
