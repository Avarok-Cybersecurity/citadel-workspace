import type { WorkspaceProtocolPayload } from './types/workspace-types';

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
 * LIMIT: JSON.parse coerces numbers to IEEE-754 doubles before any reviver
 * runs, so a u64 above Number.MAX_SAFE_INTEGER cannot survive this transport
 * at all. Encoding and decoding both fail fast on such values instead of
 * silently corrupting them. Carrying full-range u64 needs a protocol change
 * (string-encoded u64 or CBOR) on the Rust side — not fixable here.
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
  'before_timestamp',
  'created_at',
  'drain_seconds',
  'edited_at',
  'max_file_transfer_size_mb',
  'revfs_storage_quota_mb',
  'timestamp',
  'updated_at',
]);

/**
 * Serialize a workspace protocol payload to the JSON bytes the server expects.
 *
 * Any `bigint` in the payload — wherever it appears — is emitted as a JSON
 * number, which serde deserializes into u64. A bigint outside the safe-integer
 * range throws a RangeError naming the field, because emitting it as a double
 * would silently change its value.
 */
export function encodeWorkspacePayload(payload: WorkspaceProtocolPayload): Uint8Array {
  const json = JSON.stringify(payload, (key, value) => {
    if (typeof value === 'bigint') {
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(
          `Workspace protocol field "${key}" is ${value}, which does not fit in a JSON number ` +
            `(|value| > Number.MAX_SAFE_INTEGER). The JSON transport cannot carry it without corruption.`
        );
      }
      return Number(value);
    }
    return value;
  });
  return new TextEncoder().encode(json);
}

/**
 * Parse workspace protocol JSON bytes into a payload whose runtime shape
 * matches the generated types: fields declared `bigint` come back as bigint.
 *
 * Throws (instead of guessing) when a declared-bigint field arrives as a
 * non-integer or as an unsafe integer — the latter means precision was already
 * lost inside JSON.parse and the true value is unrecoverable.
 */
export function decodeWorkspacePayload(
  bytes: number[] | Uint8Array | string
): WorkspaceProtocolPayload {
  const text =
    typeof bytes === 'string'
      ? bytes
      : new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  return JSON.parse(text, (key, value) => {
    if (WORKSPACE_BIGINT_FIELDS.has(key) && typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new RangeError(
          `Workspace protocol field "${key}" arrived as ${value}, which is not a safe integer; ` +
            `its u64 value cannot be recovered from JSON.`
        );
      }
      return BigInt(value);
    }
    return value;
  }) as WorkspaceProtocolPayload;
}
