/**
 * What a person is told when a channel's new document is refused because the workspace holds
 * all the chat documents its plan allows (the kernel's `ChatDocumentLimitReached`, counted
 * across every node). Like secure links' limit, admins are also told where packs are bought.
 */
import type { DocumentSessionProblem } from '@/lib/cdoc/collab/session-errors';

export const CHAT_DOCUMENT_LIMIT_COPY: { readonly admins: string } = {
  admins: 'Workspace admins can add 5,000-document packs (Business plan) under Admin settings → Manage subscription.',
};

/** The limit `problem` reached, or null when it is not the chat-document limit. */
export function chatDocumentLimitOf(problem: DocumentSessionProblem): number | null {
  if (problem.kind !== 'refused' || typeof problem.refusal === 'string' || !('ChatDocumentLimitReached' in problem.refusal)) return null;
  return problem.refusal.ChatDocumentLimitReached.limit;
}

/** The notice's second line: where packs are bought, for those who can buy them; none otherwise. */
export function limitNoticeDetail(problem: DocumentSessionProblem, managesSubscription: boolean): string | undefined {
  return chatDocumentLimitOf(problem) !== null && managesSubscription ? CHAT_DOCUMENT_LIMIT_COPY.admins : undefined;
}
