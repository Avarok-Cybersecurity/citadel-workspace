/**
 * What a chat document reports instead of swallowing: a peer or a stored copy in another
 * format (refused, never applied), what could not be read, sent, stored or applied.
 */
import type { PresenceProblem } from '../collab/document-presence';

export type ChatSyncProblem =
  | PresenceProblem
  /** The peer's payload, or this device's stored copy, is in another CRDT format: refused, never applied. */
  | { readonly kind: 'docVersionMismatch'; readonly expected: number; readonly received: number; readonly where: 'the peer' | 'the stored copy' }
  /** The two copies were moved from different originals (null: not moved), so they are held apart. */
  | { readonly kind: 'migrationMismatch'; readonly ours: string | null; readonly theirs: string | null }
  /** A payload from the peer, or a stored record, is not in the shape this client writes. */
  | { readonly kind: 'unreadable'; readonly what: string; readonly cause: unknown }
  /** This device's copy could not be read or written. */
  | { readonly kind: 'storeFailed'; readonly operation: 'read' | 'write'; readonly cause: unknown }
  /** The stored copy belongs to the chat with another peer. */
  | { readonly kind: 'otherChat'; readonly docId: string };

export class ChatSyncError extends Error {
  readonly problem: ChatSyncProblem;

  constructor(problem: ChatSyncProblem) {
    super(describeChatProblem(problem));
    this.name = problem.kind === 'docVersionMismatch' ? 'DocVersionMismatchError' : 'ChatSyncError';
    this.problem = problem;
  }
}

const causeOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export function describeChatProblem(problem: ChatSyncProblem): string {
  switch (problem.kind) {
    case 'docVersionMismatch':
      return `${problem.where === 'the peer' ? 'The other person\'s copy' : 'The copy on this device'} is in document format ${problem.received}; this client reads format ${problem.expected}, so it was not applied`;
    case 'migrationMismatch':
      return 'This document was moved to the new editor from a different version here than on the other person\'s device, so the two copies are kept apart and changes are no longer exchanged';
    case 'unreadable':
      return `${problem.what} could not be read: ${causeOf(problem.cause)}`;
    case 'storeFailed':
      return `The copy of the document on this device could not be ${problem.operation === 'read' ? 'read' : 'saved'}: ${causeOf(problem.cause)}`;
    case 'otherChat':
      return `The document ${problem.docId} on this device belongs to another conversation`;
    case 'sendFailed':
      return `The ${problem.request} could not be sent; it is sent again when the other person reconnects: ${causeOf(problem.cause)}`;
    case 'editorFailed':
      return `The editor failed to ${problem.operation}: ${causeOf(problem.cause)}`;
    case 'tooLarge':
      return `The ${problem.what} is ${problem.sizeBytes} bytes; one message carries at most ${problem.maxBytes}`;
  }
}
