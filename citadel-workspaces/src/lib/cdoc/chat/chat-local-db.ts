/**
 * This account's chat documents in the agent's LocalDB. Every request names the LOCAL ACCOUNT's
 * cid, which the agent's ownership gate (citadel-internal-service requests/mod.rs) admits only
 * for the connection that owns that session; the device-wide cid 0 is readable by every account
 * signed in to the agent, so it is refused here outright. Keys name the account too, so a copy
 * never answers for another account even on a backend that shares one keyspace:
 *
 *   `cdoc-chat:<account>:<docId>#base`     the snapshot a reopen starts from
 *   `cdoc-chat:<account>:<docId>#pending`  the updates applied since that snapshot, in order
 *   `cdoc-chat:<account>:#index`           each docId with the peer's cid and the title (LWW stamp)
 *
 * Values are CBOR (bytes stay bytes, cids bigints) carried as the agent's number arrays. A key
 * that is not there reads as nothing; a failed read is an error, never "nothing kept".
 */
import { decode as cborDecode, encode as cborEncode } from 'cbor-x';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import type { CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import type { ChatIndexEntry, ChatStoreBackend, StoredBase } from './chat-ports';
import { isChatDocId, readTitleStamp } from './chat-wire';

/** The agent's key-value requests for a session (websocketService.sendLocalDB*). */
export interface LocalDbPort {
  get(cid: bigint, key: string): Promise<{ readonly value: readonly number[] } | null>;
  set(cid: bigint, key: string, value: number[]): Promise<void>;
}

type Fields = Record<string, unknown>;

const prefix = (account: bigint): string => `cdoc-chat:${account.toString()}:`;
const docKey = (account: bigint, docId: string, record: 'base' | 'pending'): string => {
  if (!isChatDocId(docId)) throw new Error(`not a chat document id: "${docId}"`);
  return `${prefix(account)}${docId}#${record}`;
};
const indexKey = (account: bigint): string => `${prefix(account)}#index`;

function fields(value: unknown, what: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not in the shape this client writes`);
  return value as Fields;
}

const copy = (view: ArrayBufferView): Uint8Array => new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();

function readBase(value: unknown): StoredBase {
  const v: Fields = fields(value, 'the stored chat document');
  if (typeof v.doc_version !== 'number' || !ArrayBuffer.isView(v.snapshot) || (v.migration_origin !== null && typeof v.migration_origin !== 'string')) {
    throw new Error('the stored chat document is not in the shape this client writes');
  }
  return { docVersion: v.doc_version, snapshot: copy(v.snapshot), migrationOrigin: v.migration_origin };
}

function readPending(value: unknown): readonly Uint8Array[] {
  const updates: unknown = fields(value, 'the stored updates').updates;
  if (!Array.isArray(updates) || !updates.every((u: unknown): boolean => ArrayBuffer.isView(u))) throw new Error('the stored updates are not in the shape this client writes');
  return updates.map((u: ArrayBufferView): Uint8Array => copy(u));
}

interface IndexRecord {
  readonly doc_id: string;
  readonly peer_cid: bigint;
  readonly title: CdocChatTitleStamp | null;
  readonly held_apart: boolean;
}

/** A list, not an object keyed by id: an id is the peer's data, and `__proto__` is a valid one. */
function readIndex(value: unknown): Map<string, ChatIndexEntry> {
  const entries: unknown = fields(value, 'the chat documents index').entries;
  if (!Array.isArray(entries)) throw new Error('the chat documents index is not in the shape this client writes');
  const index: Map<string, ChatIndexEntry> = new Map<string, ChatIndexEntry>();
  for (const raw of entries) {
    const e: Fields = fields(raw, 'an index entry');
    if (typeof e.doc_id !== 'string' || typeof e.peer_cid !== 'bigint') throw new Error('an index entry names no document or no peer');
    if (typeof e.held_apart !== 'boolean') throw new Error('an index entry does not say whether it is held apart');
    index.set(e.doc_id, { peerCid: e.peer_cid, title: e.title === null ? null : readTitleStamp(e.title), heldApart: e.held_apart });
  }
  return index;
}

/** Index updates are read-modify-write, so one account's run one at a time in this tab. */
const indexTails: Map<bigint, Promise<void>> = new Map<bigint, Promise<void>>();

export function localDbChatStore(account: bigint, db: LocalDbPort): ChatStoreBackend {
  if (account <= 0n) throw new Error(`chat documents are kept under the local account, not cid ${account.toString()}`);
  const get = async (key: string): Promise<unknown> => {
    let found: { readonly value: readonly number[] } | null;
    try {
      found = await db.get(account, key);
    } catch (error: unknown) {
      if (isGenuinelyAbsent(error)) return undefined;
      throw error;
    }
    return found === null ? undefined : cborDecode(Uint8Array.from(found.value));
  };
  const put = (key: string, value: unknown): Promise<void> => db.set(account, key, Array.from(cborEncode(value)));
  const index = async (): Promise<Map<string, ChatIndexEntry>> => {
    const stored: unknown = await get(indexKey(account));
    return stored === undefined ? new Map<string, ChatIndexEntry>() : readIndex(stored);
  };
  return {
    loadBase: async (docId: string): Promise<StoredBase | null> => {
      const stored: unknown = await get(docKey(account, docId, 'base'));
      return stored === undefined ? null : readBase(stored);
    },
    saveBase: (docId: string, base: StoredBase): Promise<void> =>
      put(docKey(account, docId, 'base'), { doc_version: base.docVersion, snapshot: base.snapshot, migration_origin: base.migrationOrigin }),
    loadPending: async (docId: string): Promise<readonly Uint8Array[]> => {
      const stored: unknown = await get(docKey(account, docId, 'pending'));
      return stored === undefined ? [] : readPending(stored);
    },
    savePending: (docId: string, updates: readonly Uint8Array[]): Promise<void> => put(docKey(account, docId, 'pending'), { updates: [...updates] }),
    loadEntry: async (docId: string): Promise<ChatIndexEntry | null> => (await index()).get(docId) ?? null,
    saveEntry: (docId: string, entry: ChatIndexEntry): Promise<void> => {
      if (!isChatDocId(docId)) return Promise.reject(new Error(`not a chat document id: "${docId}"`));
      const step = async (): Promise<void> => {
        const all: Map<string, ChatIndexEntry> = await index();
        all.set(docId, entry);
        const entries: IndexRecord[] = [...all].map(([id, e]: [string, ChatIndexEntry]): IndexRecord => ({ doc_id: id, peer_cid: e.peerCid, title: e.title, held_apart: e.heldApart }));
        await put(indexKey(account), { entries });
      };
      const next: Promise<void> = (indexTails.get(account) ?? Promise.resolve()).then(step, step);
      indexTails.set(account, next.then((): void => undefined, (): void => undefined));
      return next;
    },
  };
}
