/**
 * Protocol Types
 *
 * Internal service notification types used by the real protocol I/O router
 * for file transfer operations.
 *
 * `ObjectTransferStatus` and `VirtualObjectMetadata` are RE-EXPORTED from the
 * generated `@avarok/citadel-protocol-types` package (ts-rs output from the
 * Rust enums) rather than declared here. This file used to hand-write both,
 * and every variant disagreed with the wire: it gave each tick an
 * `object_id` field the real enum does not carry, made `TransferComplete`
 * and `ReceptionComplete` objects when they are bare strings, and gave the
 * request metadata a `file_size`/`mime_type` the real `VirtualObjectMetadata`
 * does not have. tsc then happily validated a parser that could never match
 * a single real notification — which is how the whole progress/complete
 * path shipped dead. Deriving from the generated types means a Rust-side
 * change breaks the build here instead of silently breaking the parser.
 *
 * The real shapes (citadel_types/src/proto/mod.rs):
 *
 *   TransferBeginning                          — bare string
 *   ReceptionBeginning(PathBuf, Metadata)      — download path + metadata
 *   TransferTick(group, total_groups, Mb/s)    — tuple, NO object id
 *   ReceptionTick(group, total_groups, Mb/s)   — tuple, NO object id
 *   TransferComplete / ReceptionComplete       — bare strings, NO object id
 *   Fail(String)                               — message only, NO object id
 *
 * Because ticks carry no object id, a tick stream is correlated to a
 * transfer by its notification envelope (cid / peer_cid / request_id), not
 * by the status payload — see tick-events.ts.
 */

export type {
  ObjectTransferStatus,
  VirtualObjectMetadata,
} from '@avarok/citadel-protocol-types';

import type { ObjectTransferStatus, VirtualObjectMetadata } from '@avarok/citadel-protocol-types';

// ============================================================================
// Notification envelopes (match the generated typescript-client types)
// ============================================================================

export interface FileTransferRequestNotification {
  cid: bigint;
  peer_cid: bigint;
  metadata: VirtualObjectMetadata;
  request_id: string | null;
}

export interface FileTransferStatusNotification {
  cid: bigint;
  object_id: bigint;
  success: boolean;
  /** true if this is a response to our request */
  response: boolean;
  message: string | null;
  request_id: string | null;
}

export interface FileTransferTickNotification {
  cid: bigint;
  peer_cid: bigint | null;
  status: ObjectTransferStatus;
  request_id: string | null;
}
