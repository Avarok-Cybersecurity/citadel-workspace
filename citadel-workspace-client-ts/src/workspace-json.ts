import type { WorkspaceProtocolPayload } from './types/workspace-types.js';
import { parseWithU64, stringifyWithU64 } from './json-u64.js';

/**
 * The single boundary between the ts-rs generated `bigint` annotations and the
 * JSON wire format of the workspace protocol.
 *
 * CAUSE: the workspace protocol travels as serde_json on the Rust side
 * (citadel-workspace-server-kernel/src/kernel/async_kernel.rs uses
 * serde_json::to_vec / from_slice), so every u64 is a JSON *number* on the
 * wire — while ts-rs generates `bigint` for those same fields.
 *
 * CONSEQUENCE without this module:
 *  - Requests: passing what the signature asks for (`before_timestamp: bigint`)
 *    made JSON.stringify throw "Do not know how to serialize a BigInt" before
 *    anything was sent.
 *  - Responses: fields declared `bigint` decoded as `number`, so strict
 *    comparisons against bigints silently failed. The UI worked around both
 *    (Number(beforeTimestamp) at call sites, a re-declared
 *    `drainSeconds: number`) — evidence the trap fires in practice.
 *
 * Full-range u64 values (peer CIDs are random 63-bit ids) cross intact in both
 * directions; see json-u64.ts for how.
 */

/**
 * Every field the generated workspace protocol types declare as `bigint`.
 *
 * SSOT NOTE: this set intentionally shadows information in
 * src/types/generated/ (which must not be hand-edited). The test
 * src/__tests__/workspace-json.test.ts re-derives the set from the generated
 * sources and fails on any drift, so regenerating the types cannot silently
 * desynchronize this list.
 */
export const WORKSPACE_BIGINT_FIELDS: ReadonlySet<string> = new Set([
  'at_ms',
  'before_timestamp',
  'created_at',
  'created_ms',
  'drain_seconds',
  'edited_at',
  'expires_at',
  'expires_ms',
  'last_used_ms',
  'max_file_transfer_size_mb',
  'max_per_user_bytes',
  'peer_cid',
  'per_user_bytes',
  'received_at_ms',
  'revfs_storage_quota_mb',
  'since_ms',
  'time_ms',
  'timestamp',
  'ttl_ms',
  'until_ms',
  'updated_at',
]);

/**
 * Serialize a workspace protocol payload to the JSON bytes the server expects.
 *
 * Any `bigint` in the payload — wherever it appears — is emitted as a JSON
 * number holding exactly its value, which serde deserializes into u64.
 */
export function encodeWorkspacePayload(payload: WorkspaceProtocolPayload): Uint8Array {
  return new TextEncoder().encode(stringifyWithU64(payload));
}

/**
 * Parse workspace protocol JSON bytes into a payload whose runtime shape
 * matches the generated types: fields declared `bigint` come back as bigint.
 *
 * Throws (instead of guessing) when a declared-bigint field arrives as a
 * non-integer, or an integer too large for a double arrives in any other field.
 */
export function decodeWorkspacePayload(
  bytes: number[] | Uint8Array | string
): WorkspaceProtocolPayload {
  const text =
    typeof bytes === 'string'
      ? bytes
      : new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  return parseWithU64(text, (key) => WORKSPACE_BIGINT_FIELDS.has(key)) as WorkspaceProtocolPayload;
}
