/**
 * One edit or delete, applied where it is stored and where it is shown.
 *
 * Shared by the inbound and outbound halves so they cannot disagree about the
 * order -- the same shape as record-reaction. The STORED page is revised first
 * and is authoritative, sender check included (message-page-revision); the
 * in-memory copy, when there is one, is then brought into line with it.
 *
 * A message in memory but in no page -- its append has not landed, or the
 * store could not be read -- is revised in memory only and reported
 * `persisted: false`, which each caller turns into its own failure report.
 */
import { applyEdit, applyDelete, type RevisionOutcome } from './message-revision';
import { messagePaginationStore } from './message-pagination-store';
import { debugLog } from '@/lib/debug-config';
import type { PageRevision, StoredRevisionOutcome } from './message-page-revision';
import type { P2PConversation, P2PMessage } from './p2p-types';

export type RecordedRevision =
  | { applied: true; message: P2PMessage; persisted: boolean }
  | { applied: false; reason: 'unknown-message' | 'not-sender' };

async function reviseStored(peerCid: bigint, messageId: string, reviserCid: bigint, revision: PageRevision): Promise<StoredRevisionOutcome | null> {
  try {
    return await messagePaginationStore.reviseMessageInPages(peerCid, messageId, reviserCid, revision);
  } catch (error) {
    // A failed WRITE is not "no such message"; fall through to memory and let
    // the caller report that it was not persisted.
    debugLog('P2PRevision', `Storing the ${revision.kind} of ${messageId} failed`, error);
    return null;
  }
}

function reviseInMemory(conversation: P2PConversation, messageId: string, reviserCid: bigint, revision: PageRevision): RevisionOutcome {
  return revision.kind === 'edit'
    ? applyEdit(conversation, messageId, revision.contents, revision.editedAt, reviserCid)
    : applyDelete(conversation, messageId, reviserCid);
}

export async function recordRevision(
  conversation: P2PConversation | undefined,
  peerCid: bigint,
  messageId: string,
  reviserCid: bigint,
  revision: PageRevision,
): Promise<RecordedRevision> {
  const stored: StoredRevisionOutcome | null = await reviseStored(peerCid, messageId, reviserCid, revision);
  if (stored?.kind === 'not-sender') return { applied: false, reason: 'not-sender' };

  if (stored?.kind === 'applied') {
    // Memory follows the page; its own sender check has already been made there.
    const index: number = conversation ? conversation.messages.findIndex((m) => m.id === messageId) : -1;
    if (conversation && index !== -1) {
      if (revision.kind === 'delete') {
        conversation.messages.splice(index, 1);
      } else {
        Object.assign(conversation.messages[index], { content: revision.contents, edited_at: revision.editedAt });
        return { applied: true, message: conversation.messages[index], persisted: true };
      }
    }
    return { applied: true, message: stored.message, persisted: true };
  }

  if (!conversation) return { applied: false, reason: 'unknown-message' };
  const inMemory: RevisionOutcome = reviseInMemory(conversation, messageId, reviserCid, revision);
  return inMemory.applied ? { applied: true, message: inMemory.message, persisted: false } : inMemory;
}
