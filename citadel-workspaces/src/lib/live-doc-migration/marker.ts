/**
 * The idempotency marker `cdoc_migrated_<id>`: written AFTER the snapshot, so its presence
 * means the snapshot it names is stored. Deleting markers is the rollback (the originals are
 * untouched, so the next open migrates again).
 *
 * CBOR, as every persisted shape with a bigint here: the client id is a u64. A marker that is
 * present but unreadable is an error, never "not migrated": treating it as absent would run a
 * second migration over a document the person may already be editing.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

export const MARKER_VERSION: 1 = 1;

export interface MigrationMarker {
  readonly v: typeof MARKER_VERSION;
  /** Hex SHA-256 of the Yjs state vector the snapshot was made from. */
  readonly originYjsSvHash: string;
  /** The CRDT client id the snapshot was written as (migration-identity.ts). */
  readonly client: bigint;
  /** Hex SHA-256 of the stored snapshot, so a reader can tell it holds the bytes this marker names. */
  readonly snapshotSha256: string;
  /** The mapper's `{"report", "problems"}` JSON, read by conversion-report.ts when shown. */
  readonly reportJson: string;
}

export class MarkerError extends Error {
  constructor(message: string) {
    super(`unreadable migration marker: ${message}`);
    this.name = 'MarkerError';
  }
}

export function encodeMarker(marker: MigrationMarker): Uint8Array {
  return Uint8Array.from(cborEncode(marker));
}

const HEX_256: RegExp = /^[0-9a-f]{64}$/;

/** cbor-x hands back a u64 that fits in 53 bits as a number; either way it must be a whole one. */
function clientOf(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  throw new MarkerError('client is not an integer');
}

export function decodeMarker(bytes: Uint8Array): MigrationMarker {
  let value: unknown;
  try {
    value = cborDecode(bytes);
  } catch (error) {
    throw new MarkerError(error instanceof Error ? error.message : String(error));
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new MarkerError('not a record');
  const fields: Record<string, unknown> = value as Record<string, unknown>;
  if (fields.v !== MARKER_VERSION) throw new MarkerError(`version ${String(fields.v)}`);
  const { originYjsSvHash, snapshotSha256, reportJson } = fields;
  if (typeof originYjsSvHash !== 'string' || !HEX_256.test(originYjsSvHash)) throw new MarkerError('no origin');
  if (typeof snapshotSha256 !== 'string' || !HEX_256.test(snapshotSha256)) throw new MarkerError('no snapshot hash');
  if (typeof reportJson !== 'string') throw new MarkerError('no report');
  const client: bigint = clientOf(fields.client);
  if (client <= 0n) throw new MarkerError('client is not a migration client id');
  return { v: MARKER_VERSION, originYjsSvHash, client, snapshotSha256, reportJson };
}
