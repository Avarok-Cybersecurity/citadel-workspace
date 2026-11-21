/**
 * Relay (TURN) types. The wire shapes are the generated ones: `IceServer` and the
 * `IceServers` variant of `WorkspaceProtocolResponse` (citadel-workspace-types), and
 * `PeerTurnConfig`, `TurnPolicy` and `P2pPathReport` (the agent's typescript-client).
 *
 * `parseIceServersAnswer` and `parsePeerPathReport` are the only readers of
 * these shapes off the wire; a sample of each is pinned in
 * lib/ice-servers/__tests__.
 */
import type { PeerPathChangedNotification, WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

/** `WorkspaceProtocolResponse::IceServers`; `expires_at` is unix seconds. */
export type IceServersGrant = Extract<WorkspaceProtocolResponse, { IceServers: unknown }>['IceServers'];

/** A path report as the agent sends it; `upgrading` means a background upgrade may still move it off a relay. */
export type PeerPathReport = Pick<PeerPathChangedNotification, 'path' | 'upgrading'>;

/** The workspace server's answer to `GetIceServers`, narrowed. */
export type IceServersAnswer =
  | { kind: 'granted'; grant: IceServersGrant }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'refused'; message: string };
