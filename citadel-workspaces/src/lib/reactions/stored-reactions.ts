/**
 * Reactions as a P2P message page stores them.
 *
 * Message pages are JSON (message-page-operations), which cannot hold a bigint,
 * and a reaction names its reactor by CID. Rather than a second string-CID
 * shape, the list is CBOR -- which carries bigint natively, like every other
 * payload here -- stored in the page as its bytes. Decoding validates every
 * entry: a page is data from disk, and one unreadable entry must not become a
 * chip that throws while rendering.
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import type { MessageReaction } from './reaction-state';

/** The bytes to put in the page, or undefined when there is nothing to keep. */
export function encodeStoredReactions(list: readonly MessageReaction[] | undefined): number[] | undefined {
  return list && list.length > 0 ? Array.from(cborEncode(list)) : undefined;
}

function toReaction(raw: unknown): MessageReaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r: Record<string, unknown> = raw as Record<string, unknown>;
  if (typeof r.emoji !== 'string' || typeof r.reactorCid !== 'bigint') return null;
  if (typeof r.at !== 'number' || typeof r.active !== 'boolean') return null;
  return { emoji: r.emoji, reactorCid: r.reactorCid, at: r.at, active: r.active };
}

/** The reactions a stored page holds; undefined when it holds none or they do not decode. */
export function decodeStoredReactions(raw: unknown): MessageReaction[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  try {
    const decoded: unknown = cborDecode(new Uint8Array(raw as number[]));
    if (!Array.isArray(decoded)) return undefined;
    const list: MessageReaction[] = decoded.map(toReaction).filter((r): r is MessageReaction => r !== null);
    return list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
}
