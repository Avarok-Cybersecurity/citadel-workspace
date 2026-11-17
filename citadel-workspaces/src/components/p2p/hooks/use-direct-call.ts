import { useCall } from '@/lib/call/call-context';
import type { VideoQuality } from '@/lib/call/video-quality';
import { DIRECT_CALL, type CallState } from '@/lib/call/call-state';
import type { ConnectionQuality } from '@/components/call/ParticipantTile';

export interface DirectCallBinding {
  /** The call belonging to THIS conversation, or null. */
  call: CallState | null;
  active: boolean;
  localStream: MediaStream | null;
  remoteStreams: Map<bigint, MediaStream>;
  remoteAudioStreams: Map<bigint, MediaStream>;
  /** Shared screens by sharer CID; a peer can be here and in remoteStreams. */
  remoteScreenStreams: Map<bigint, MediaStream>;
  /** This tab's own share, so the sharer sees what everyone else sees. */
  screenStream: MediaStream | null;
  qualities: Map<bigint, ConnectionQuality>;
  capability: { supported: boolean; reason?: string };
  startCall: (video: boolean) => void;
  leave: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  annotate: (stroke: { strokeId: string; point: { x: number; y: number } }) => void;
  videoQuality: VideoQuality;
  setVideoQuality: (quality: VideoQuality) => void;
}

/**
 * Binds the app-wide call to one direct conversation.
 *
 * The scoping is the whole point: a call is global to the tab, but its surface
 * belongs to exactly one conversation. Without these conditions a call with one
 * person renders its stage over an unrelated chat.
 */
export function useDirectCall(peerCid: bigint, peerName: string): DirectCallBinding {
  const {
    call,
    localStream,
    remoteStreams,
    remoteAudioStreams,
    remoteScreenStreams,
    screenStream,
    qualities,
    capability,
    startCall,
    leave,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    annotate,
    videoQuality,
    setVideoQuality,
  } = useCall();

  // The home must be direct: a GROUP call that happens to include this peer belongs
  // to its room's surface, not to the 1:1 chat with them.
  //
  // 'ended' is excluded but 'failed' deliberately is not. A call the user left
  // has nothing more to say, and leaving its surface up makes Leave look like it
  // did not work — but a call that FAILED still owes them the reason, which the
  // stage renders.
  const active: boolean =
    call !== null &&
    call.home.kind === 'direct' &&
    call.participants.has(peerCid) &&
    call.status !== 'ended';


  return {
    call: active ? call : null,
    active,
    localStream,
    remoteStreams,
    remoteAudioStreams,
    remoteScreenStreams,
    screenStream,
    qualities,
    capability,
    startCall: (video) => void startCall([{ cid: peerCid, username: peerName }], video, DIRECT_CALL),
    leave: () => void leave(),
    toggleMic: () => void toggleMic(),
    toggleCamera: () => void toggleCamera(),
    toggleScreenShare: () => void toggleScreenShare(),
    annotate,
    videoQuality,
    setVideoQuality,
  };
}
