/**
 * Editing a document with the link down: the server cannot be asked whether this account may
 * edit it, so the last answer it gave here stands, kept with the document's other records on
 * this device (document-replica-cache.ts, removed with them). Only "could not be asked" falls
 * back to it; a real answer, yes or no, always wins. Safe because the server checks again on
 * every edit it is sent: one it refuses stays on the device and is said to be unsaved.
 */
import type { ActionGate, UsePermissionResult } from '@/hooks/use-permission-result';
import { documentAccessKey, localRecordGet, localRecordPut } from '@/lib/document-replica-cache';

export function rememberEditAnswer(account: bigint, nodeId: string, canEdit: boolean): Promise<void> {
  return localRecordPut(documentAccessKey(account, nodeId), { canEdit });
}

/** The last answer kept here, or null for none; a malformed record is an error, not "no answer". */
export async function lastKnownEditAnswer(account: bigint, nodeId: string): Promise<boolean | null> {
  const value: unknown = await localRecordGet(documentAccessKey(account, nodeId));
  if (value === undefined) return null;
  const canEdit: unknown = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).canEdit : undefined;
  if (typeof canEdit !== 'boolean') throw new Error('the document\'s kept edit answer is not in the shape this client writes');
  return canEdit;
}

/** Whether `answer` is the server's (yes or no), as opposed to loading or unanswered. */
export function isServerAnswer(answer: UsePermissionResult): boolean {
  return answer.answered && !answer.loading && !answer.unanswered;
}

/** The edit gate: the live one, except that an unanswered check takes a kept yes. */
export function offlineEditGate(answer: UsePermissionResult, lastKnown: boolean | null, live: ActionGate): ActionGate {
  return answer.unanswered && lastKnown === true ? { enabled: true, reason: null } : live;
}
