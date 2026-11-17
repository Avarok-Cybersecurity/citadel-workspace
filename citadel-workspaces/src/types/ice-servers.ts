/**
 * Relay (TURN) wire types, mirrored by hand from two Rust sources until the
 * generated bindings that carry them reach this repo:
 *
 *   - `IceServer`, and the `IceServers` / `IceServersUnavailable` variants of
 *     `WorkspaceProtocolResponse`: citadel-workspace-types/src/ice.rs and
 *     src/lib.rs (the ts-rs export is bindings/IceServer.ts). The UI takes
 *     workspace types from citadel-workspace-client-ts, which lives in the
 *     parent repo; its copy does not have these yet.
 *   - `TurnConfig` on `InternalServiceRequest::PeerConnect`, and `path` and
 *     `upgrading` on `PeerConnectSuccess` and `PeerPathChangedNotification`:
 *     citadel-internal-service-types (the agent). Its
 *     regenerated typescript-client names them `PeerTurnConfig`, `TurnPolicy`
 *     and `P2pPathReport`, with the same shapes as here.
 *
 * `parseIceServersAnswer` and `parsePeerPathReport` are the only readers of
 * these shapes off the wire; a sample of each is pinned in
 * lib/ice-servers/__tests__.
 */

/** One `RTCConfiguration.iceServers` entry. `credential` is a TURN password. */
export interface IceServer {
  urls: string[];
  username: string | null;
  credential: string | null;
}

/** `WorkspaceProtocolResponse::IceServers`; `expires_at` is unix seconds. */
export interface IceServersGrant {
  ice_servers: IceServer[];
  expires_at: bigint;
}

export type TurnPolicy = 'fallback' | 'relay_only';

/** The optional `turn` field of `PeerConnect`. */
export interface TurnConfig {
  policy: TurnPolicy;
  ice_servers: IceServer[];
  expires_at: bigint;
}

/**
 * `PeerConnectSuccess.path` and `PeerPathChangedNotification.path`: where the
 * connection's traffic goes NOW. A connection is delivered over the server relay
 * and may move to a direct or TURN path later, so no one report is final.
 */
export type PeerConnectPath = 'direct' | 'turn' | 'server_relay';

/** A path report as the agent sends it; `upgrading` means a background upgrade may still move it off a relay. */
export interface PeerPathReport {
  path: PeerConnectPath;
  upgrading: boolean;
}

/** The workspace server's answer to `GetIceServers`, narrowed. */
export type IceServersAnswer =
  | { kind: 'granted'; grant: IceServersGrant }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'refused'; message: string };
