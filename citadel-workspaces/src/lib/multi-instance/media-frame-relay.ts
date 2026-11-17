/**
 * A follower tab's outgoing media frames, carried to the leader's socket.
 *
 * One browser has one socket to the agent, owned by the leader tab. The call
 * itself -- capture, encoders, decoders, the tiles -- lives in the tab whose
 * session is in the call, because a MediaStream cannot cross tabs and
 * capturing in two would duplicate it. So only the encoded frame crosses, once,
 * and the leader puts it on the wire for the session it names. The leader
 * decodes nothing; inbound frames go the other way by cid (routing-rules.ts).
 *
 * Deliberately outside the outbound queue: no request id, no ack, no retention
 * and no replay to a new leader. A frame is worth something for a sixtieth of
 * a second; a lost one is a gap the receiver already recovers from with a
 * keyframe request, and a replayed one is a worse artefact than the gap. That
 * is the same reasoning UNRELIABLE_FORWARDS applies to the inbound direction.
 */

export const MEDIA_FRAME_OUT: 'media-frame-out' = 'media-frame-out';

export interface RelayedFrame {
  /** The session sending: the follower's own, never the leader's. */
  cid: bigint;
  peerCid: bigint;
  track: number;
  kind: number;
  timestamp: number;
  flags: number;
  payload: Uint8Array;
}

/** The leader's socket, as far as a relayed frame needs it. */
export interface MediaFrameSink {
  sendMediaFrame(
    localCid: bigint,
    peerCid: bigint,
    track: number,
    kind: number,
    timestamp: number,
    flags: number,
    payload: Uint8Array,
  ): void;
}

function isWireNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * The frame a channel message carries, or null for anything else.
 *
 * Checked, not trusted: it arrives from another document, and an older build
 * of this app in another tab can be sharing the channel.
 */
export function readRelayedFrame(payload: unknown): RelayedFrame | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p: Record<string, unknown> = payload as Record<string, unknown>;
  if (typeof p.cid !== 'bigint' || typeof p.peerCid !== 'bigint') return null;
  if (!isWireNumber(p.track) || !isWireNumber(p.kind) || !isWireNumber(p.timestamp) || !isWireNumber(p.flags)) return null;
  // Structured clone keeps a Uint8Array a Uint8Array, but not across realms
  // for `instanceof`; a view is what the socket takes either way.
  if (!ArrayBuffer.isView(p.payload)) return null;
  const view: ArrayBufferView = p.payload;
  return {
    cid: p.cid,
    peerCid: p.peerCid,
    track: p.track,
    kind: p.kind,
    timestamp: p.timestamp,
    flags: p.flags,
    payload: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  };
}

/**
 * Put a relayed frame on this tab's socket, if this tab is the one that has it.
 *
 * Nothing is reported back, on purpose: a frame that is not sent is a gap the
 * receiver reports (MediaGapNotification) and recovers from with a keyframe.
 * A follower that hears the message (a stale leader, mid-election) drops it:
 * two tabs sending the same frame is exactly the duplicated stream this
 * exists to avoid.
 */
export function deliverRelayedFrame(payload: unknown, isLeader: boolean, sink: MediaFrameSink | null): void {
  if (!isLeader || !sink) return;
  const frame: RelayedFrame | null = readRelayedFrame(payload);
  if (!frame) return;
  try {
    sink.sendMediaFrame(frame.cid, frame.peerCid, frame.track, frame.kind, frame.timestamp, frame.flags, frame.payload);
  } catch {
    // One frame failing is not worth anything more; the next is 16ms away.
  }
}

export interface MediaFrameRelayDeps {
  on: (event: string, handler: (payload: unknown) => void) => void;
  isLeader: () => boolean;
  /** This tab's socket client; null in a follower, or before the socket opens. */
  sink: () => MediaFrameSink | null;
}

/** The leader's end: a 'media-frame-out' channel message, put on this tab's socket. */
export function installMediaFrameRelay(deps: MediaFrameRelayDeps): void {
  deps.on(MEDIA_FRAME_OUT, (payload: unknown): void => {
    deliverRelayedFrame(payload, deps.isLeader(), deps.sink());
  });
}
