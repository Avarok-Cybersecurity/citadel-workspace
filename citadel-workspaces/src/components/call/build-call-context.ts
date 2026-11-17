import type { CallContextValue } from '@/lib/call/call-context';
import type { CallState } from '@/lib/call/call-state';
import type { CaptureFailure } from '@/lib/call/media-capture';
import type { ConnectionQuality } from './ParticipantTile';
import type { CallMediaKinds } from '@/types/p2p-commands';
import type { VideoQuality } from '@/lib/call/video-quality';

/** The streams and screen a live session exposes; absent between calls. */
interface SessionLike {
  getLocalStream: () => MediaStream | null;
  getRemoteStreams: () => Map<bigint, MediaStream>;
  getRemoteAudioStreams: () => Map<bigint, MediaStream>;
  getRemoteScreenStreams: () => Map<bigint, MediaStream>;
  getScreenStream: () => MediaStream | null;
}

interface CallActions {
  startCall: CallContextValue['startCall'];
  accept: CallContextValue['accept'];
  decline: CallContextValue['decline'];
  leave: CallContextValue['leave'];
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
}

/**
 * Assemble what the call context hands to the tree.
 *
 * Split out of `CallProvider`, which was over its length ceiling: the provider
 * owns the call's LIFECYCLE, and this is the shape of one snapshot of it. There
 * is no decision here beyond "a session that does not exist has no streams",
 * which is why it can be read in one screen.
 */
export function buildCallContext(input: {
  call: CallState | null;
  session: SessionLike | null;
  qualities: Map<bigint, ConnectionQuality>;
  captureFailure: CaptureFailure | null;
  capability: { supported: boolean; reason?: string };
  actions: CallActions;
  videoQuality: VideoQuality;
  setVideoQuality: (quality: VideoQuality) => void;
  annotate: (stroke: { strokeId: string; point: { x: number; y: number } }) => void;
}): CallContextValue {
  const { session, actions } = input;
  const empty: Map<bigint, MediaStream> = new Map<bigint, MediaStream>();
  return {
    call: input.call,
    localStream: session?.getLocalStream() ?? null,
    remoteStreams: session?.getRemoteStreams() ?? empty,
    remoteAudioStreams: session?.getRemoteAudioStreams() ?? empty,
    remoteScreenStreams: session?.getRemoteScreenStreams() ?? empty,
    screenStream: session?.getScreenStream() ?? null,
    qualities: input.qualities,
    captureFailure: input.captureFailure,
    capability: input.capability,
    startCall: actions.startCall,
    accept: actions.accept,
    decline: actions.decline,
    leave: actions.leave,
    toggleMic: actions.toggleMic,
    toggleCamera: actions.toggleCamera,
    toggleScreenShare: actions.toggleScreenShare,
    videoQuality: input.videoQuality,
    setVideoQuality: input.setVideoQuality,
    annotate: input.annotate,
  };
}

export type { CallMediaKinds };
