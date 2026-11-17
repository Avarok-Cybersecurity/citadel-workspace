/**
 * Which local account a device-wide chat document belongs to.
 *
 * Every `live_doc_*` key sits under cid 0, shared by every account signed in on this device.
 * A chat document is between two accounts and its metadata names both: `creatorCid` (as the
 * chat records it today: the account that stored the record on this device, the creator or
 * the recipient who adopted it) and `peerCid` (the other side of the chat). The rule: an
 * account may migrate a document only when it is one of those two. Any other local account
 * leaves it alone, and so never copies another account's document into its own LocalDB.
 *
 * Deciding needs the metadata, so the original is read under cid 0 first; a document refused
 * here is neither walked nor written anywhere.
 */
import type { DocumentMetadata } from '@/lib/live-document-store/types';

export type Ownership =
  | { readonly kind: 'owned'; readonly role: 'holder' | 'peer' }
  | { readonly kind: 'not-owned'; readonly reason: string };

/** The metadata's cids are decimal strings (the store's JSON); anything else names no account. */
function cidOf(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  return BigInt(value);
}

export function documentOwnership(metadata: Pick<DocumentMetadata, 'creatorCid' | 'peerCid'>, accountCid: bigint): Ownership {
  const holder: bigint | null = cidOf(metadata.creatorCid);
  const peer: bigint | null = cidOf(metadata.peerCid);
  if (holder === null && peer === null) return { kind: 'not-owned', reason: 'the document names no account' };
  if (holder === accountCid) return { kind: 'owned', role: 'holder' };
  if (peer === accountCid) return { kind: 'owned', role: 'peer' };
  return { kind: 'not-owned', reason: 'the document belongs to another account on this device' };
}
