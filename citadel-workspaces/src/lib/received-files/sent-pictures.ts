/**
 * The pictures this account sent, kept so the sender's own bubble shows them full size, after
 * a reload too, as the receiver's does.
 *
 * Once a send is handed to the agent the page keeps no copy, and the offer carries only a 100px
 * thumbnail. The agent is not the place to read it back from: a browser send's payload is
 * deleted when its transfer ends (browser_payload.rs), and a native-picker send names a file of
 * the person's own that may since have moved. So the picked file is kept here, in IndexedDB,
 * for the conversation it was sent in, when it passes the same decode limits as a received
 * picture (pictureOf). Each conversation keeps at most SENT_PICTURE_BUDGET_BYTES, the oldest
 * dropped first.
 *
 * Pure over its store (SBIO): sent-picture-store.ts is the browser's.
 */
import { MAX_PREVIEW_BYTES, pictureOf, type Picture } from './image-preview';

/** The most one conversation keeps of the pictures sent in it. */
export const SENT_PICTURE_BUDGET_BYTES: number = 64 * 1024 * 1024;

export interface SentPictureEntry {
  readonly blob: Blob;
  readonly size: number;
  readonly at: number;
}

export interface SentPictureStore {
  put(key: string, entry: SentPictureEntry): Promise<void>;
  get(key: string): Promise<SentPictureEntry | undefined>;
  keys(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/** Whose conversation a sent picture belongs to: this account, the peer, the transfer. */
export interface SentPictureOf {
  readonly own: string;
  readonly peer: string;
  readonly transferId: string;
}

const conversationPrefix = (of: Omit<SentPictureOf, 'transferId'>): string => `citadel:sent-picture:${of.own}:${of.peer}:`;
const keyOf = (of: SentPictureOf): string => `${conversationPrefix(of)}${of.transferId}`;

/** The keys to drop so the conversation's pictures fit the budget, oldest first. */
export function overBudget(entries: readonly { key: string; size: number; at: number }[], budget: number): string[] {
  let total: number = entries.reduce((sum: number, e: { size: number }): number => sum + e.size, 0);
  const drop: string[] = [];
  for (const e of [...entries].sort((a, b): number => a.at - b.at)) {
    if (total <= budget) break;
    drop.push(e.key);
    total -= e.size;
  }
  return drop;
}

/** Keeps `file` when it is a picture within the limits; says why not when it is not. */
export async function rememberSentPicture(store: SentPictureStore, of: SentPictureOf, file: Blob, now: number): Promise<string | null> {
  if (file.size === 0 || BigInt(file.size) > MAX_PREVIEW_BYTES || file.size > SENT_PICTURE_BUDGET_BYTES) return 'not kept: over the size a picture is kept at';
  const picture: Picture | string = pictureOf(new Uint8Array(await file.arrayBuffer()));
  if (typeof picture === 'string') return `not kept: ${picture}`;
  await store.put(keyOf(of), { blob: file, size: file.size, at: now });
  const prefix: string = conversationPrefix(of);
  const entries: { key: string; size: number; at: number }[] = [];
  for (const key of await store.keys(prefix)) {
    const entry: SentPictureEntry | undefined = await store.get(key);
    if (entry) entries.push({ key, size: entry.size, at: entry.at });
  }
  for (const key of overBudget(entries, SENT_PICTURE_BUDGET_BYTES)) await store.delete(key);
  return null;
}

export async function sentPicture(store: SentPictureStore, of: SentPictureOf): Promise<Blob | undefined> {
  return (await store.get(keyOf(of)))?.blob;
}
