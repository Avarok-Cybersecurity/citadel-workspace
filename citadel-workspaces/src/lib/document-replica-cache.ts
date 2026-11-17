/**
 * The one seam for what this device keeps of an account's workspace in IndexedDB: document
 * copies (lib/cdoc/collab/document-cache.ts), each document's unacknowledged local edits and
 * per-device choices, and the last-known workspace tree. Every read, write and removal of the
 * `cdoc-collab:` family goes through here, so encryption at rest (lib/at-rest, loaded only when
 * a sealed record is read or the account's setting is on) covers all of them. Outside lib/cdoc
 * so sign-out and the node handlers can remove copies without loading the editor.
 *
 * Keys, all under `cdoc-collab:<account>:`, with `#` reserved (a node id is a uuid):
 *   `<node>`                    the document's base copy (snapshot and seq)
 *   `<node>#edits:<instance>`   one tab instance's edits the server has not acknowledged
 *   `<node>#device`             this device's choices for the document
 *   `<node>#access`             the account's last answer to "may I edit it?", for offline
 *   `<node>/<chat doc>…`        the same records for a document shared in the node's chat
 *   `#tree`                     the last-known workspace tree (no node: deletion never matches it)
 *   `#at-rest`                  the account's encryption setting on this device, never sealed
 *
 * A read accepts a value sealed or not, so a conversion cut short leaves every record readable
 * (or locked, never misread); a write seals when the setting is on, read at each write.
 */
import { dbDelete, dbGet, dbKeysWithPrefix, dbPut } from '@/lib/storage-utils';
import { readCachedTree, type CachedWorkspaceTree } from '@/lib/offline-tree';
import { isAtRestEnvelope, readAtRestMode, type AtRestMode } from '@/lib/at-rest/at-rest-shape';

const ROOT: string = 'cdoc-collab:';
const RESERVED: string = '#';
const CHAT: string = '/';
const accountPrefix = (account: bigint): string => `${ROOT}${account.toString()}:`;

/** A node id names a node: it is not empty and holds no `#`. Ids are the server's, so data. */
const isNodeId = (nodeId: string): boolean => nodeId.length > 0 && !nodeId.includes(RESERVED);

function nodeKey(account: bigint, nodeId: string): string {
  if (!isNodeId(nodeId)) throw new Error(`not a node id: "${nodeId}"`);
  return `${accountPrefix(account)}${nodeId}`;
}

export const documentCacheKey = (account: bigint, nodeId: string): string => nodeKey(account, nodeId);
export const documentEditsPrefix = (account: bigint, nodeId: string): string => `${nodeKey(account, nodeId)}${RESERVED}edits:`;
export const documentEditsKey = (account: bigint, nodeId: string, instance: string): string => `${documentEditsPrefix(account, nodeId)}${instance}`;
export const documentDeviceKey = (account: bigint, nodeId: string): string => `${nodeKey(account, nodeId)}${RESERVED}device`;
export const documentAccessKey = (account: bigint, nodeId: string): string => `${nodeKey(account, nodeId)}${RESERVED}access`;
/** Where a chat document's records sit: under its node, so the node's removal takes them too. */
export const chatDocumentRecordId = (nodeId: string, chatDoc: string): string => `${nodeId}${CHAT}${chatDoc}`;

/** Which document records are of: a node's page (`chatDoc` null) or a document shared in its chat. */
export interface DocumentPlace {
  readonly nodeId: string;
  readonly chatDoc: string | null;
}

export const documentRecordId = (place: DocumentPlace): string => (place.chatDoc === null ? place.nodeId : chatDocumentRecordId(place.nodeId, place.chatDoc));

/** The place a record id names: the inverse of documentRecordId. */
export function documentPlaceOf(recordId: string): DocumentPlace {
  const split: number = recordId.indexOf(CHAT);
  return split < 0 ? { nodeId: recordId, chatDoc: null } : { nodeId: recordId.slice(0, split), chatDoc: recordId.slice(split + 1) };
}
export const workspaceTreeKey = (account: bigint): string => `${accountPrefix(account)}${RESERVED}tree`;
export const atRestModeKey = (account: bigint): string => `${accountPrefix(account)}${RESERVED}at-rest`;
export const accountRecordsPrefix = (account: bigint): string => accountPrefix(account);

/** Where a key keeps its value: the account, the node ('' for `#tree`) and the kind of record. */
export function recordPlace(key: string): { readonly account: bigint; readonly node: string; readonly kind: string } {
  const rest: string = key.slice(ROOT.length);
  const colon: number = rest.indexOf(':');
  if (!key.startsWith(ROOT) || colon <= 0 || !/^\d+$/.test(rest.slice(0, colon))) throw new Error(`not a device record key: "${key}"`);
  const record: string = rest.slice(colon + 1);
  const reserved: number = record.indexOf(RESERVED);
  return { account: BigInt(rest.slice(0, colon)), node: reserved < 0 ? record : record.slice(0, reserved), kind: reserved < 0 ? 'base' : record.slice(reserved + 1) };
}

const atRest = (): Promise<typeof import('@/lib/at-rest/at-rest-records')> => import('@/lib/at-rest/at-rest-records');
const modeOf = async (account: bigint): Promise<AtRestMode> => readAtRestMode(await dbGet<unknown>('keyValue', atRestModeKey(account)));

const resumed: Map<bigint, Promise<void>> = new Map<bigint, Promise<void>>();
/** A conversion cut short (a crash, a closed tab) is finished on the account's first record access here. */
function resumeOnce(account: bigint): void {
  if (resumed.has(account)) return;
  resumed.set(account, modeOf(account)
    .then(async (mode: AtRestMode): Promise<void> => { if (mode.converting) await (await atRest()).resume(account); })
    .catch((error: unknown): void => { console.warn('[document-replica-cache] Finishing the encryption change on this device failed:', error); resumed.delete(account); }));
}

export async function localRecordGet(key: string): Promise<unknown> {
  resumeOnce(recordPlace(key).account);
  const stored: unknown = await dbGet<unknown>('keyValue', key);
  return isAtRestEnvelope(stored) ? (await atRest()).openRecord(key, stored) : stored;
}

export async function localRecordPut(key: string, value: unknown): Promise<void> {
  const { account } = recordPlace(key);
  resumeOnce(account);
  await dbPut('keyValue', key, (await modeOf(account)).on ? await (await atRest()).sealRecord(key, value) : value);
}

export const localRecordRemove = (key: string): Promise<void> => dbDelete('keyValue', key);

/** Whether this account's records are sealed on this device. */
export async function documentsAtRest(account: bigint): Promise<boolean> {
  return (await modeOf(account)).on;
}

/** Seals or opens every record of the account in place; refused (AtRestRefusedError) with nothing changed. */
export async function setDocumentsAtRest(account: bigint, on: boolean): Promise<void> {
  const records: typeof import('@/lib/at-rest/at-rest-records') = await atRest();
  await (on ? records.turnOn(account) : records.turnOff(account));
}

/** Sign-out, before the session ends: the account's encryption root goes with its records. */
export async function forgetAtRestRoot(account: bigint): Promise<void> {
  await (await atRest()).forgetRoot(account);
}

export async function localRecordsWithPrefix(prefix: string): Promise<{ readonly key: string; readonly value: unknown }[]> {
  const records: { readonly key: string; readonly value: unknown }[] = [];
  for (const key of await dbKeysWithPrefix('keyValue', prefix)) records.push({ key, value: await localRecordGet(key) });
  return records;
}

/** The node a key is about: what follows the account up to `#`; '' for `#tree` and `#at-rest`. */
const nodeOf = (key: string): string => recordPlace(key).node;

async function forgetKeys(keys: readonly string[]): Promise<void> {
  for (const key of keys) await localRecordRemove(key);
}

/** The documents this account has edits held of on this device (sent by no tab yet), pages and chat documents alike. */
export async function documentsWithHeldEdits(account: bigint): Promise<DocumentPlace[]> {
  const held: Set<string> = new Set<string>();
  for (const key of await dbKeysWithPrefix('keyValue', accountPrefix(account))) {
    if (key.includes(`${RESERVED}edits:`)) held.add(nodeOf(key));
  }
  return [...held].map(documentPlaceOf);
}

/** Sign-out: every record of the account, documents, edits, choices and tree. */
export async function forgetAccountDocuments(account: bigint): Promise<void> {
  await forgetKeys(await dbKeysWithPrefix('keyValue', accountPrefix(account)));
}

/**
 * Whether `key` is a record of one of `ids`: a node id takes its page's and its chat documents'
 * records; a chat document's record id takes only its own. An id that is no node's ('', '#tree')
 * would match the tree's record, never a document's, so it matches nothing.
 */
function recordOfAny(ids: readonly string[]): (key: string) => boolean {
  const wanted: ReadonlySet<string> = new Set<string>(ids.filter(isNodeId));
  return (key: string): boolean => {
    const record: string = nodeOf(key);
    return wanted.has(record) || wanted.has(documentPlaceOf(record).nodeId);
  };
}

/** Every record about these nodes (or chat documents) for one account: the copy, its edits and its choices. */
export async function forgetNodeDocuments(account: bigint, ids: readonly string[]): Promise<void> {
  await forgetKeys((await dbKeysWithPrefix('keyValue', accountPrefix(account))).filter(recordOfAny(ids)));
}

/** A node deleted on its server is gone, chat documents and all, for every account here that held a copy of it. */
export async function forgetDeletedNodes(nodeIds: readonly string[]): Promise<void> {
  await forgetKeys((await dbKeysWithPrefix('keyValue', ROOT)).filter(recordOfAny(nodeIds)));
}

/** The account's last-known workspace tree (lib/offline-tree.ts), or null when none is kept. */
export async function loadWorkspaceTree(account: bigint): Promise<CachedWorkspaceTree | null> {
  return readCachedTree(await localRecordGet(workspaceTreeKey(account)));
}

export const saveWorkspaceTree = (account: bigint, tree: CachedWorkspaceTree): Promise<void> => localRecordPut(workspaceTreeKey(account), tree);
