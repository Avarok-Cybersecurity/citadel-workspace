/**
 * Message Page Operations
 *
 * Low-level page I/O operations for the paginated message store.
 * Handles reading/writing individual pages and metadata to LocalDB.
 *
 * For agents before 0.8.6 only. A 0.8.6 agent that hosts the account keeps
 * these records itself (agent-conversations/agent-store.ts answers instead),
 * and refuses a window's write to them. This path goes once no supported
 * agent predates 0.8.6 (docs/plans/multi-window-sessions.md).
 */

import { websocketService } from '../websocket-service';
import { stringToBytes, bytesToString } from '../utils/encoding-utils';
import type {
  ConversationMetadata,
  MessagePage,
  P2PMessage,
} from './p2p-types';
import { conversationPrefix, legacyConversationPrefix, hasLegacyFallback } from './message-page-keys';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { debugLog } from '@/lib/debug-config';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { encodeStoredReactions, decodeStoredReactions } from '@/lib/reactions/stored-reactions';

/**
 * Load metadata by full key.
 */
export async function loadMetadataByKey(key: string): Promise<ConversationMetadata | null> {
  try {
    const response: { value: number[]; } | null = await websocketService.sendLocalDBGet(0n, key);
    if (response?.value) {
      const rawValue: number[] = response.value;
      let valueStr: string;
      if (Array.isArray(rawValue)) {
        valueStr = bytesToString(rawValue);
      } else if (typeof rawValue === 'string') {
        valueStr = rawValue;
      } else {
        return null;
      }
      const parsed: Record<string, unknown> = JSON.parse(valueStr) as Record<string, unknown>;
      return {
        ...parsed,
        // Parsed back to bigint, like peerCid. Serialized as a string and left
        // as one, every ownership comparison is string-vs-bigint and therefore
        // always false — which silently turns the delete guard into "refuse
        // everything", including the account's own sweep.
        ownerCid: typeof parsed.ownerCid === 'string' ? BigInt(parsed.ownerCid) : parsed.ownerCid,
        peerCid: typeof parsed.peerCid === 'string' ? BigInt(parsed.peerCid) : parsed.peerCid
      } as ConversationMetadata;
    }
    return null;
  } catch (error) {
    if (isGenuinelyAbsent(error)) return null;
    // Anything else is a failure to READ, not an absence of data. Returning
    // null here is what let a 5s timeout be mistaken for a new conversation.
    throw error;
  }
}

/**
 * Load metadata for a specific peer.
 */
export async function loadMetadata(peerCid: bigint): Promise<ConversationMetadata | null> {
  const scoped: ConversationMetadata | null = await loadMetadataByKey(`${conversationPrefix(peerCid)}_metadata`);
  if (scoped || !hasLegacyFallback(peerCid)) return scoped;

  // Nothing under the account-scoped key. Records written before conversations
  // were scoped live under the peer-only prefix; read them so existing history
  // is not orphaned by the rename.
  //
  // Only OURS, though: an unattributed record predates the ownerCid stamp and
  // could belong to anyone, but adopting it is the same guess the old shared
  // key made. A record stamped for a different account is left alone.
  const legacy: ConversationMetadata | null = await loadMetadataByKey(`${legacyConversationPrefix(peerCid)}_metadata`);
  if (!legacy) return null;
  if (legacy.ownerCid !== undefined && legacy.ownerCid !== instanceManager.cid) {
    debugLog('MessagePageOperations', `[P2P] Legacy conversation ${peerCid.toString().slice(0, 8)} belongs to another account`);
    return null;
  }
  return legacy;
}

/** Read a page under the legacy peer-only prefix, for conversations not yet migrated. */
async function loadLegacyMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> {
  return loadMessagePageByKey(`${legacyConversationPrefix(peerCid)}_${pageNumber}`);
}

/**
 * Save metadata for a peer.
 */
export async function saveMetadata(peerCid: bigint, metadata: ConversationMetadata): Promise<void> {
  const key: string = `${conversationPrefix(peerCid)}_metadata`;
  const serializableMetadata: { peerCid: string; ownerCid: string | undefined; peerUsername?: string; totalMessageCount: number; oldestMessageTimestamp: number; newestMessageTimestamp: number; latestPage: number; messagesPerPage: number; unreadCount: number; lastMessageIndex: number; lastUpdated: number; } = {
    ...metadata,
    peerCid: metadata.peerCid.toString(),
    // Stamped so this record can later be proved ours — see ConversationMetadata.
    ownerCid: metadata.ownerCid === undefined ? undefined : metadata.ownerCid.toString(),
  };
  const valueStr: string = JSON.stringify(serializableMetadata);
  const valueBytes: number[] = stringToBytes(valueStr);
  await websocketService.sendLocalDBSet(0n, key, valueBytes);
}

/**
 * Load a specific page of messages for a peer.
 */
export async function loadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> {
  const scoped: MessagePage | null = await loadMessagePageByKey(`${conversationPrefix(peerCid)}_${pageNumber}`);
  if (scoped || !hasLegacyFallback(peerCid)) return scoped;
  // Pre-scoping history: loadMetadata has already refused a record owned by
  // another account, so reaching here means this conversation is ours.
  return loadLegacyMessagePage(peerCid, pageNumber);
}

async function loadMessagePageByKey(key: string): Promise<MessagePage | null> {
  try {
    const response: { value: number[]; } | null = await websocketService.sendLocalDBGet(0n, key);
    if (response?.value) {
      const rawValue: number[] = response.value;
      let valueStr: string;
      if (Array.isArray(rawValue)) {
        valueStr = bytesToString(rawValue);
      } else if (typeof rawValue === 'string') {
        valueStr = rawValue;
      } else {
        return null;
      }
      const parsed: MessagePage & { peerCid: string | bigint; messages: Array<P2PMessage & { senderCid: string | bigint; recipientCid: string | bigint; }>; } = JSON.parse(valueStr) as MessagePage & {
        peerCid: string | bigint;
        messages: Array<P2PMessage & { senderCid: string | bigint; recipientCid: string | bigint }>;
      };
      return {
        ...parsed,
        peerCid: typeof parsed.peerCid === 'string' ? BigInt(parsed.peerCid) : parsed.peerCid,
        messages: parsed.messages.map((m) => ({
          ...m,
          senderCid: typeof m.senderCid === 'string' ? BigInt(m.senderCid) : m.senderCid,
          recipientCid: typeof m.recipientCid === 'string' ? BigInt(m.recipientCid) : m.recipientCid,
          reactions: decodeStoredReactions(m.reactions),
        }))
      } as MessagePage;
    }
    return null;
  } catch (error) {
    if (isGenuinelyAbsent(error)) return null;
    // Anything else is a failure to READ, not an absence of data. Returning
    // null here is what let a 5s timeout be mistaken for a new conversation.
    throw error;
  }
}

/**
 * Save a page of messages for a peer.
 */
export async function saveMessagePage(peerCid: bigint, pageNumber: number, page: MessagePage): Promise<void> {
  const key: string = `${conversationPrefix(peerCid)}_${pageNumber}`;
  const serializablePage: Omit<MessagePage, 'peerCid' | 'messages'> & {
    peerCid: string;
    messages: (Omit<P2PMessage, 'senderCid' | 'recipientCid' | 'reactions'> & { senderCid: string; recipientCid: string; reactions?: number[] })[];
  } = {
    ...page,
    peerCid: page.peerCid.toString(),
    messages: page.messages.map(m => ({
      ...m,
      senderCid: m.senderCid.toString(),
      recipientCid: m.recipientCid.toString(),
      reactions: encodeStoredReactions(m.reactions),
    }))
  };
  const valueStr: string = JSON.stringify(serializablePage);
  const valueBytes: number[] = stringToBytes(valueStr);
  await websocketService.sendLocalDBSet(0n, key, valueBytes);
}

/**
 * `loadMetadata`, but a failed read is reported as absence.
 *
 * For callers where "could not read" and "not there" lead to the same
 * harmless outcome — skip the update, render nothing yet. The append path
 * must NOT use this: there, treating a failed read as a new conversation is
 * what overwrites page 0 and orphans the rest.
 */
export async function tryLoadMetadata(peerCid: bigint): Promise<ConversationMetadata | null> {
  try {
    return await loadMetadata(peerCid);
  } catch {
    return null;
  }
}

/** `loadMessagePage`, with the same tolerance as tryLoadMetadata. */
export async function tryLoadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> {
  try {
    return await loadMessagePage(peerCid, pageNumber);
  } catch {
    return null;
  }
}
