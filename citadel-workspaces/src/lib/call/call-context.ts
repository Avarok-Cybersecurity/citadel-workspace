import { createContext, useContext , type Context } from 'react';
import type { CallHome, CallState } from './call-state';
import type { CaptureFailure } from './media-capture';
import type { CallMediaKinds } from '@/types/p2p-commands';
import type { VideoQuality } from './video-quality';
import type { ConnectionQuality } from '@/components/call/ParticipantTile';

export interface CallContextValue {
  /** The current call, or null when there is none. */
  call: CallState | null;
  localStream: MediaStream | null;
  remoteStreams: Map<bigint, MediaStream>;
  /** Remote audio per peer. Must be attached to an element or nobody hears. */
  remoteAudioStreams: Map<bigint, MediaStream>;
  /**
   * Shared screens, by the CID of whoever is sharing.
   *
   * Separate from `remoteStreams` because a screen and a face are shown in
   * different places at different sizes. A peer can appear in both.
   */
  remoteScreenStreams: Map<bigint, MediaStream>;
  /** This tab's own share, for the local preview. Null when not sharing. */
  screenStream: MediaStream | null;
  /** Per-peer link health, for the tiles. Absent entries read as 'good'. */
  qualities: Map<bigint, ConnectionQuality>;
  /** Why capture failed, so the surface can explain rather than just fail. */
  captureFailure: CaptureFailure | null;
  /** Whether this browser can do calls at all, with the reason if not. */
  capability: { supported: boolean; reason?: string };
  startCall: (peers: Array<{ cid: bigint; username: string }>, video: boolean, home: CallHome) => Promise<void>;
  accept: (media: CallMediaKinds) => Promise<void>;
  decline: () => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /**
   * Start or stop sharing this screen.
   *
   * Must be called from a user gesture: the browser's picker will not open
   * otherwise, and the rejection is indistinguishable from a refusal.
   */
  toggleScreenShare: () => Promise<void>;
  /** Send one drawn point to the other participants. */
  annotate: (stroke: { strokeId: string; point: { x: number; y: number } }) => void;
  /** The chosen quality ceiling for outgoing video; see lib/call/video-quality. */
  videoQuality: VideoQuality;
  setVideoQuality: (quality: VideoQuality) => void;
}

/**
 * Defaults that no-op rather than throw.
 *
 * Components that read call state are rendered in tests and in surfaces mounted
 * outside the provider; refusing to render there would be worse than simply
 * having no call.
 */
export const CallContext: Context<CallContextValue> = createContext<CallContextValue>({
  call: null,
  localStream: null,
  remoteStreams: new Map(),
  remoteAudioStreams: new Map(),
  remoteScreenStreams: new Map(),
  screenStream: null,
  qualities: new Map(),
  captureFailure: null,
  capability: { supported: false, reason: 'Calling is not available here.' },
  startCall: async () => {},
  accept: async () => {},
  decline: async () => {},
  leave: async () => {},
  toggleMic: async () => {},
  toggleCamera: async () => {},
  toggleScreenShare: async () => {},
  annotate: () => {},
  videoQuality: 'auto',
  setVideoQuality: () => {},
});

export function useCall(): CallContextValue {
  return useContext(CallContext);
}
