/**
 * What a migration is derived from, so two devices holding the same Yjs state agree on it
 * without talking: its origin (the hash of the state vector) and the CRDT client id its
 * snapshot is written as.
 *
 * client = the first 64 bits (big-endian) of SHA-256("cdoc-migrate" | docId | stateVector),
 * never 0 (cdoc reserves client 0 for the deterministic blank). With the same id and the same
 * input, cdoc writes byte-identical snapshots, so two devices' migrations merge as a no-op.
 * Only the migration snapshot is written as this id: an editing replica always takes a random
 * client id of its own.
 */

const TAG: string = 'cdoc-migrate';
const SEPARATOR: number = 0x7c; // '|'
const WORD_BYTES: number = 8;

export interface MigrationIdentity {
  /** Hex SHA-256 of the Yjs state vector: what a peer compares to tell same-origin migrations. */
  readonly origin: string;
  readonly client: bigint;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // A copy in this realm's own ArrayBuffer: Web Crypto refuses a view over a SharedArrayBuffer.
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b: number): string => b.toString(16).padStart(2, '0')).join('');

function readWord(digest: Uint8Array, offset: number): bigint {
  let word: bigint = 0n;
  for (let i: number = offset; i < offset + WORD_BYTES; i += 1) word = (word << 8n) | BigInt(digest[i]);
  return word;
}

/**
 * The client id a digest names: its first 64-bit word, or, should that word be zero, the next
 * non-zero one. A digest of nothing but zero words names no client at all and is refused.
 */
export function clientFromDigest(digest: Uint8Array): bigint {
  if (digest.length < WORD_BYTES || digest.length % WORD_BYTES !== 0) throw new Error(`a ${digest.length}-byte digest holds no whole 64-bit word`);
  for (let offset: number = 0; offset < digest.length; offset += WORD_BYTES) {
    const word: bigint = readWord(digest, offset);
    if (word !== 0n) return word;
  }
  throw new Error('the digest is all zero, which names no client id');
}

function clientInput(docId: string, stateVector: Uint8Array): Uint8Array {
  const tag: Uint8Array = new TextEncoder().encode(TAG);
  const id: Uint8Array = new TextEncoder().encode(docId);
  const input: Uint8Array = new Uint8Array(tag.length + 1 + id.length + 1 + stateVector.length);
  input.set(tag, 0);
  input[tag.length] = SEPARATOR;
  input.set(id, tag.length + 1);
  input[tag.length + 1 + id.length] = SEPARATOR;
  input.set(stateVector, tag.length + id.length + 2);
  return input;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await sha256(bytes));
}

export function migrationOrigin(stateVector: Uint8Array): Promise<string> {
  return sha256Hex(stateVector);
}

export async function migrationIdentity(docId: string, stateVector: Uint8Array): Promise<MigrationIdentity> {
  const [origin, digest]: [string, Uint8Array] = await Promise.all([migrationOrigin(stateVector), sha256(clientInput(docId, stateVector))]);
  return { origin, client: clientFromDigest(digest) };
}
