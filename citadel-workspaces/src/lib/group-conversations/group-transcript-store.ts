/**
 * A peer group's transcript, kept in IndexedDB so it survives a reload.
 *
 * Same store and same rules as `group-persistence`: structured clone keeps the
 * bigint timestamps as bigint (no JSON), and the key names the account, so two
 * accounts in one browser never read each other's messages. It also names the
 * group, so one group's write never has to rewrite another's.
 */
import { dbGet, dbPut } from '@/lib/storage-utils';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { mergeOlder } from '@/lib/group-message-list';
import { debugLog } from '@/lib/debug-config';
import type { GroupMessage } from '@/types/workspace-entities';
import { foldTranscript, type TranscriptChange } from './group-transcript';

const STORE: "keyValue" = 'keyValue';

function transcriptKey(groupId: string): string | null {
  const own: bigint | null = instanceManager.cid;
  // No session, no account to file it under; guessing is how one account
  // inherits another's messages.
  return own ? `group-transcript:${own.toString()}:${groupId}` : null;
}

/**
 * The last write queued for each key.
 *
 * Every change is a read-modify-write of one value. Two arrivals in the same
 * tick would otherwise both read the old transcript and the second write would
 * drop the first message.
 */
const pending: Map<string, Promise<void>> = new Map<string, Promise<void>>();

async function applyChange(key: string, change: TranscriptChange): Promise<void> {
  let stored: GroupMessage[] | undefined;
  try {
    stored = await dbGet<GroupMessage[]>(STORE, key);
  } catch (error) {
    // Refusing is the point, as in group-persistence: a failed read is not an
    // empty transcript, and writing one message over it would erase the rest.
    debugLog('GroupTranscript', 'Not recording: the transcript could not be read', error);
    return;
  }
  const before: GroupMessage[] = Array.isArray(stored) ? stored : [];
  const after: GroupMessage[] = foldTranscript(before, change);
  if (after === before) return;
  try {
    await dbPut(STORE, key, after);
  } catch (error) {
    debugLog('GroupTranscript', 'Could not store the transcript', error);
  }
}

/**
 * Record one change for the CURRENT account. The key is taken now, not when
 * the queued write runs, so a session switch mid-queue cannot file a message
 * under the account that arrived afterwards.
 */
export function recordTranscriptChange(groupId: string, change: TranscriptChange): Promise<void> {
  const key: string | null = transcriptKey(groupId);
  if (!key) return Promise.resolve();
  const previous: Promise<void> = pending.get(key) ?? Promise.resolve();
  const next: Promise<void> = previous.then((): Promise<void> => applyChange(key, change));
  pending.set(key, next);
  return next;
}

export async function loadTranscript(groupId: string): Promise<GroupMessage[]> {
  const key: string | null = transcriptKey(groupId);
  if (!key) return [];
  // Read after write: a message sent a moment ago is still in the queue.
  await pending.get(key);
  try {
    const stored: GroupMessage[] | undefined = await dbGet<GroupMessage[]>(STORE, key);
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    debugLog('GroupTranscript', 'Could not read the transcript', error);
    return [];
  }
}

/**
 * Put the stored transcript in front of the open conversation.
 *
 * Merged with what the manager already holds rather than replacing it, and the
 * in-memory copy wins a tie: a message that arrived while the read was in
 * flight is newer than anything on disk.
 */
export async function restoreGroupTranscript(groupId: string): Promise<void> {
  const stored: GroupMessage[] = await loadTranscript(groupId);
  const live: GroupMessage[] = groupMessagingManager.getMessages(groupId).messages;
  groupMessagingManager.handleMessagesLoaded(groupId, mergeOlder(stored, live), false);
}
