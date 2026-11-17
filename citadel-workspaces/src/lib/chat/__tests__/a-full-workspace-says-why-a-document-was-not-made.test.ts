/**
 * A channel's new document refused because the workspace holds every chat document its plan
 * allows says so with the limit, stops the document's writing (its edits would never be stored),
 * and tells only those who may buy packs where they are bought.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentRefusal } from 'citadel-workspace-client-ts';
import { DocumentSessionError, haltsWriting, type DocumentSessionProblem } from '@/lib/cdoc/collab/session-errors';
import { CHAT_DOCUMENT_LIMIT_COPY, limitNoticeDetail } from '../chat-document-limit';

const FULL: DocumentRefusal = { ChatDocumentLimitReached: { node_id: 'room-1', limit: 1000 } };
const UNKNOWN: DocumentRefusal = { ChatDocumentLimitUnavailable: { node_id: 'room-1' } };
const refused = (refusal: DocumentRefusal): DocumentSessionProblem => ({ kind: 'refused', refusal });

describe('a chat document over the workspace limit', () => {
  it('says the limit, and that the document was not made', () => {
    expect(new DocumentSessionError(refused(FULL)).message).toBe('This workspace already holds the 1,000 chat documents its plan allows, so this document was not made.');
    expect(new DocumentSessionError(refused(UNKNOWN)).message).toMatch(/could not say how many chat documents/);
  });

  it('stops writing, as the log will never hold its edits', () => {
    expect([haltsWriting(FULL), haltsWriting(UNKNOWN)]).toEqual([true, true]);
  });

  it('tells admins where packs are bought, and nobody else', () => {
    expect(limitNoticeDetail(refused(FULL), true)).toBe(CHAT_DOCUMENT_LIMIT_COPY.admins);
    expect(limitNoticeDetail(refused(FULL), false)).toBeUndefined();
    expect(limitNoticeDetail(refused(UNKNOWN), true)).toBeUndefined();
    expect(limitNoticeDetail(refused({ NoSuchNode: { node_id: 'room-1' } }), true)).toBeUndefined();
  });
});
