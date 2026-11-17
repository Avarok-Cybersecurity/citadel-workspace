/**
 * The server's limits on the Documents sub-protocol, as this client must respect them.
 *
 * MIRRORS the kernel's required `[documents]` table (parent
 * `docker/workspace-server/kernel.toml`, read by `kernel/documents/mod.rs`); the protocol does
 * not announce them, so the client holds this one copy, and `relay-limits-mirror.test.ts`
 * fails when it disagrees with the kernel's file. The sender and its rate limiter read it from
 * here and nowhere else.
 */
export interface DocumentsRelayLimits {
  /** `max_update_bytes`: the largest single CRDT update `Append` accepts. */
  readonly maxUpdateBytes: number;
  /** `max_snapshot_bytes`: the largest snapshot `StoreSnapshot` accepts. */
  readonly maxSnapshotBytes: number;
  /** `max_awareness_bytes`: the largest awareness payload relayed. */
  readonly maxAwarenessBytes: number;
  /** `awareness_per_second`: awareness payloads one session may send per second. */
  readonly awarenessPerSecond: number;
  /** `appends_per_second`: Appends one account may send per second, over all its documents. */
  readonly appendsPerSecond: number;
  /** `pulls_per_second`: Pulls one account may send per second, over all its documents. */
  readonly pullsPerSecond: number;
}

export const DOCUMENTS_RELAY_LIMITS: DocumentsRelayLimits = {
  maxUpdateBytes: 65_536,
  maxSnapshotBytes: 4_194_304,
  maxAwarenessBytes: 4_096,
  awarenessPerSecond: 10,
  appendsPerSecond: 50,
  pullsPerSecond: 10,
};

/**
 * The cdoc-crdt wire format the editor's updates and snapshots are written in: the `VERSION`
 * byte of cdoc-crdt's `update/wire` header (format v2, citadel-docs PR #17). Sent as
 * `doc_version` on every Append and StoreSnapshot, and required on every payload received.
 */
export const CDOC_CRDT_DOC_VERSION: number = 2;
