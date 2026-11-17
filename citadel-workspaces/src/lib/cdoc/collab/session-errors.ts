/**
 * What a DocumentSession reports instead of swallowing: every refusal, every payload in a
 * format it cannot read, every permission the server denied.
 */
import type { DocumentRefusal } from 'citadel-workspace-client-ts';
import type { MissingUnit } from '../editor/controller';
import { SENDING_PAUSED_TEXT } from '@/lib/document-save/save-status-text';

export type DocumentSessionProblem =
  /** The server refused a Documents request. */
  | { readonly kind: 'refused'; readonly refusal: DocumentRefusal }
  /** The server answered a request with "Permission denied: …". */
  | { readonly kind: 'permissionDenied'; readonly message: string }
  /** A payload's `doc_version` is not the one this client reads and writes. */
  | { readonly kind: 'docVersionMismatch'; readonly expected: number; readonly received: number; readonly where: string }
  /** A local payload is over the server's limit, so it was never sent. */
  | { readonly kind: 'tooLarge'; readonly what: 'update' | 'snapshot' | 'awareness'; readonly sizeBytes: number; readonly maxBytes: number }
  /** An editor call failed (applyRemote of a peer's update, snapshot, peerView, opening). */
  | { readonly kind: 'editorFailed'; readonly operation: string; readonly cause: unknown }
  /**
   * An applied update left operations waiting for a unit this replica lacks, or the pending
   * limits dropped some: the log, applied in order, should never leave either, so the replica
   * no longer holds everything the log does.
   */
  | { readonly kind: 'updatesWaiting'; readonly operation: string; readonly missing: MissingUnit | null; readonly dropped: bigint }
  /** The local cache could not be read (the document is pulled whole instead), written or cleared. */
  | { readonly kind: 'cacheFailed'; readonly operation: 'read' | 'write' | 'forget'; readonly cause: unknown }
  /** A request could not be handed to the transport. */
  | { readonly kind: 'sendFailed'; readonly request: string; readonly cause: unknown };

export class DocumentSessionError extends Error {
  readonly problem: DocumentSessionProblem;

  constructor(problem: DocumentSessionProblem) {
    super(describeProblem(problem));
    this.name = problem.kind === 'docVersionMismatch' ? 'DocVersionMismatchError' : 'DocumentSessionError';
    this.problem = problem;
  }
}

function describeProblem(problem: DocumentSessionProblem): string {
  switch (problem.kind) {
    case 'refused':
      return refusedText(problem.refusal);
    case 'permissionDenied':
      return problem.message;
    case 'docVersionMismatch':
      return `${problem.where} is in document format ${problem.received}; this client reads format ${problem.expected}`;
    case 'tooLarge':
      return `The ${problem.what} is ${problem.sizeBytes} bytes; the server accepts at most ${problem.maxBytes}`;
    case 'editorFailed':
      return `The editor failed to ${problem.operation}: ${causeOf(problem.cause)}`;
    case 'updatesWaiting':
      return `After it had to ${problem.operation}, the editor holds operations that wait for ${problem.missing === null ? 'nothing it names' : `client ${problem.missing.client.toString()} clock ${problem.missing.clock.toString()}`}${problem.dropped > 0n ? `, and its limits dropped ${problem.dropped.toString()}` : ''}`;
    case 'cacheFailed':
      return `The local copy of the document could not be ${CACHE_OPERATION[problem.operation]}: ${causeOf(problem.cause)}`;
    case 'sendFailed':
      return `The ${problem.request} request could not be sent: ${causeOf(problem.cause)}`;
  }
}

/**
 * Refusals of a request the server will take later: the request is retried (refused-retry.ts)
 * and reported only if the refusals persist.
 */
export function retryLater(refusal: DocumentRefusal): 'append' | 'pull' | null {
  if (typeof refusal === 'string') return null;
  if ('AppendRateLimited' in refusal || 'LogFull' in refusal) return 'append';
  if ('PullRateLimited' in refusal) return 'pull';
  return null;
}

/** The kernel's name for a refusal: the variant, whatever kinds the kernel adds later. */
export function refusalName(refusal: DocumentRefusal): string {
  return typeof refusal === 'string' ? refusal : Object.keys(refusal)[0];
}

/** What a notice of `problem` is about: its kind, and for a refusal, which one. */
export function noticeKind(problem: DocumentSessionProblem): string {
  return problem.kind === 'refused' ? `refused:${refusalName(problem.refusal)}` : problem.kind;
}

const CACHE_OPERATION: Readonly<Record<'read' | 'write' | 'forget', string>> = {
  read: 'read; it is fetched whole instead',
  write: 'saved',
  forget: 'removed from this device',
};

function causeOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function refusedText(refusal: DocumentRefusal): string {
  if (typeof refusal !== 'string' && 'ChatDocumentLimitReached' in refusal) {
    return `This workspace already holds the ${refusal.ChatDocumentLimitReached.limit.toLocaleString('en-US')} chat documents its plan allows, so this document was not made.`;
  }
  if (typeof refusal !== 'string' && 'ChatDocumentLimitUnavailable' in refusal) {
    return 'The server could not say how many chat documents this workspace may hold, so this document was not made.';
  }
  return retryLater(refusal) === null ? `The server refused the document request: ${refusalName(refusal)}` : SENDING_PAUSED_TEXT;
}

/**
 * Refusals after which this session must stop writing: its replica holds an edit the log
 * never will, or the log is gone (or, for a chat document over its workspace's limit, was never made). The rest (a snapshot someone else already stored, an
 * awareness payload rate-limited) are reported and the session carries on.
 */
export function haltsWriting(refusal: DocumentRefusal): boolean {
  if (refusal === 'NoSession' || refusal === 'NotConfigured') return true;
  return 'NoSuchNode' in refusal || 'UpdateTooLarge' in refusal || 'ChatDocumentLimitReached' in refusal || 'ChatDocumentLimitUnavailable' in refusal;
}
