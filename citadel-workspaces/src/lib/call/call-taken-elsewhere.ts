/**
 * One account signed in to several tabs: a call is answered in exactly one.
 *
 * An invite is routed by cid, and every tab holding that account's session
 * receives it (route-by-cid.ts), so each one rings. Nothing told the others
 * when the user answered in one of them: they went on ringing, and when a
 * ring deadline expired that tab sent CallEnd('unanswered') to the caller --
 * ending the call the user had just picked up next door.
 *
 * So the tab that answers or declines says so on the instance channel, and
 * every other tab of that account still ringing for that call stands down
 * without a word to the caller: the decision has been made, and it was not
 * theirs to send.
 */
import type { CallState } from './call-state';

export const CALL_TAKEN: 'call-taken' = 'call-taken';

export interface CallTaken {
  /** The session whose call it is. */
  cid: bigint;
  callId: string;
  /** Answered there, rather than declined. Decides what this tab says. */
  answered: boolean;
}

/** A 'call-taken' channel payload, or null for anything else (it crosses documents). */
export function readCallTaken(payload: unknown): CallTaken | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p: Record<string, unknown> = payload as Record<string, unknown>;
  if (typeof p.cid !== 'bigint' || typeof p.callId !== 'string' || typeof p.answered !== 'boolean') return null;
  return { cid: p.cid, callId: p.callId, answered: p.answered };
}

/**
 * Whether this tab stops ringing because another tab of the same session took
 * the call. Only a call still ringing here: one this tab already answered is
 * its own, and the other tab's word cannot end it.
 */
export function standsDown(taken: CallTaken, selfCid: bigint | null, state: CallState | null): boolean {
  if (selfCid === null || taken.cid !== selfCid) return false;
  return state !== null && state.callId === taken.callId && state.status === 'ringing-in';
}
