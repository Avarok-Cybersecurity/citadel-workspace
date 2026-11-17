/**
 * The I/O boundary for calls.
 *
 * Everything the call manager does to the outside world goes through this
 * interface, so the manager itself holds no sockets, no WASM handles and no
 * timers of its own. That is what lets the invite/accept/open-session ordering
 * — the part that actually goes wrong — be tested without a browser, a peer, or
 * a running internal service.
 */

import type { CallSignalPayload } from '@/types/p2p-commands';
import type { WireFrame } from './frame-codec';

export interface CallTransport {
  /** Ask the service to open a media session with this peer. */
  openSession(peerCid: bigint): Promise<void>;
  /** Release the media session. The peer connection itself stays up. */
  closeSession(peerCid: bigint): Promise<void>;
  /** Put one encoded frame on the wire. Fire-and-forget. */
  sendFrame(peerCid: bigint, frame: WireFrame): void;
  /** Send call control on the reliable path. */
  sendSignal(peerCid: bigint, signal: CallSignalPayload): Promise<void>;
}
