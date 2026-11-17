/**
 * P2P Registration Service - Type Definitions
 *
 * All interfaces, type aliases, and re-exports for the P2P registration module.
 */

// Re-export security types from central location (DRY)
import {
  type SessionSecuritySettings,
  type HeaderObfuscatorSettings,
} from '../security-utils';

export type { SessionSecuritySettings, HeaderObfuscatorSettings };

export interface Peer {
  cid: bigint;
  username: string;
  fullName: string;
  /**
   * Whether the agent reports this peer as reachable — `null` when it has not
   * said.
   *
   * It used to be a plain boolean, and the same absent fact was invented three
   * different ways: `online_status !== undefined ? online_status : true` in
   * discovery (so a peer the agent said nothing about showed a green dot), a
   * hardcoded `true` in registration, and `?? false` in the poller. `presence.ts`
   * then ORs the registry's flag with the live poll, so an invented `true`
   * outranked the real answer.
   *
   * Null is falsy, so a surface that renders `isOnline && <Dot/>` is already
   * correct; the surfaces that say the word "Offline" have to decide what to
   * say instead, which is the point.
   */
  isOnline: boolean | null;
  isRegistered: boolean;
}

/** Shape of peer info from ListAllPeers/ListRegisteredPeers backend responses */
export interface PeerInfoResponse {
  cid?: bigint;
  username?: string;
  peer_username?: string;
  name?: string;
  online_status?: boolean;
}

export interface PeerRegistrationOptions {
  autoRegisterAll?: boolean;
}

/** Pending request tracking for promise-based request/response correlation */
export interface PendingRequestEntry {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
}
