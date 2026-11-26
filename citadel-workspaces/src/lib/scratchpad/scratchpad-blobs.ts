/**
 * The bytes of files kept in the scratchpad, in the agent's LocalDB under the LOCAL ACCOUNT's cid
 * (never the device-wide cid 0, which every account signed in to the agent can read), and keyed
 * by the account too. Nothing here is sent anywhere: a scratchpad file stays on this device.
 *
 *   `scratchpad:<account>:file:<sha256>`       the manifest: size and chunk count (CBOR)
 *   `scratchpad:<account>:file:<sha256>#<n>`   chunk n of the bytes
 *
 * A file is kept under the SHA-256 of its bytes, which a read checks, so a damaged or swapped
 * record is refused rather than handed over. Pure over its LocalDB port (SBIO).
 *
 * A chat document's pictures (the scratchpad's, and a direct chat's copy) are kept the same way,
 * in a key space of the document's own (`documentPictureBlobs`): `cdoc-picture:<account>:<docId>:<sha256>`.
 */
import { decode as cborDecode, encode as cborEncode } from 'cbor-x';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import type { LocalDbPort } from '@/lib/cdoc/chat/chat-local-db';
import { isChatDocId } from '@/lib/cdoc/chat/chat-wire';

/** The largest file the scratchpad keeps: it travels to the agent over this page's socket. */
export const SCRATCHPAD_FILE_LIMIT: number = 16 * 1024 * 1024;
const CHUNK_BYTES: number = 256 * 1024;
const STORE_VERSION: number = 1;

export type Hash = (bytes: Uint8Array) => Promise<string>;

export interface ScratchpadBlobs {
  /** Keeps `bytes`; resolves with the id they are kept under. */
  keep(bytes: Uint8Array): Promise<string>;
  read(id: string): Promise<Uint8Array>;
}

/** A read of a file this device does not keep: absent, not damaged. */
export class NotKeptHere extends Error {
  constructor() {
    super('This file is not kept on this device');
    this.name = 'NotKeptHere';
  }
}

const SHA256_HEX: RegExp = /^[0-9a-f]{64}$/;

const fileKey = (account: bigint, id: string): string => {
  if (!SHA256_HEX.test(id)) throw new Error(`not a scratchpad file id: "${id}"`);
  return `scratchpad:${account.toString()}:file:${id}`;
};

const pictureKey = (account: bigint, docId: string, id: string): string => {
  if (!isChatDocId(docId)) throw new Error(`not a chat document id: "${docId}"`);
  if (!SHA256_HEX.test(id)) throw new Error(`not a picture id: "${id}"`);
  return `cdoc-picture:${account.toString()}:${docId}:${id}`;
};

async function load(db: LocalDbPort, account: bigint, key: string): Promise<Uint8Array | null> {
  try {
    const got: { readonly value: readonly number[] } | null = await db.get(account, key);
    return got === null ? null : Uint8Array.from(got.value);
  } catch (error: unknown) {
    if (isGenuinelyAbsent(error)) return null;
    throw error;
  }
}

function manifestOf(bytes: Uint8Array): { size: number; chunks: number } {
  const value: unknown = cborDecode(bytes);
  const m: Record<string, unknown> = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  if (m.store_version !== STORE_VERSION || typeof m.size !== 'number' || typeof m.chunks !== 'number') {
    throw new Error('This scratchpad file was kept in a layout this page does not read');
  }
  return { size: m.size, chunks: m.chunks };
}

export function scratchpadBlobs(account: bigint, db: LocalDbPort, hash: Hash): ScratchpadBlobs {
  return keyedBlobs(account, db, hash, (id: string): string => fileKey(account, id));
}

/** The pictures of the account's chat document `docId` (a scratchpad's or a direct chat's), kept as files are. */
export function documentPictureBlobs(account: bigint, docId: string, db: LocalDbPort, hash: Hash): ScratchpadBlobs {
  return keyedBlobs(account, db, hash, (id: string): string => pictureKey(account, docId, id));
}

function keyedBlobs(account: bigint, db: LocalDbPort, hash: Hash, keyOf: (id: string) => string): ScratchpadBlobs {
  if (account === 0n) throw new Error('The scratchpad is kept per account, never under the device-wide cid 0');
  return {
    keep: async (bytes: Uint8Array): Promise<string> => {
      if (bytes.length > SCRATCHPAD_FILE_LIMIT) throw new Error(`The scratchpad keeps files up to ${SCRATCHPAD_FILE_LIMIT / (1024 * 1024)} MB`);
      const id: string = await hash(bytes);
      const key: string = keyOf(id);
      const chunks: number = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
      // Chunks first, manifest last: the manifest is the only pointer to them.
      for (let n: number = 0; n < chunks; n += 1) {
        await db.set(account, `${key}#${n}`, Array.from(bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES)));
      }
      await db.set(account, key, Array.from(cborEncode({ store_version: STORE_VERSION, size: bytes.length, chunks })));
      return id;
    },
    read: async (id: string): Promise<Uint8Array> => {
      const key: string = keyOf(id);
      const manifest: Uint8Array | null = await load(db, account, key);
      if (manifest === null) throw new NotKeptHere();
      const { size, chunks } = manifestOf(manifest);
      const out: Uint8Array = new Uint8Array(size);
      let at: number = 0;
      for (let n: number = 0; n < chunks; n += 1) {
        const chunk: Uint8Array | null = await load(db, account, `${key}#${n}`);
        if (chunk === null || at + chunk.length > size) throw new Error('Part of this file is missing on this device');
        out.set(chunk, at);
        at += chunk.length;
      }
      if (at !== size || (await hash(out)) !== id) throw new Error('This file was damaged on this device and cannot be opened');
      return out;
    },
  };
}
