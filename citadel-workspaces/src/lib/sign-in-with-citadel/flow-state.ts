/**
 * The sign-in page's states (sign-in-with-citadel.md §1a; design SIGN-IN-IDENTITY-PROOF.md §5-§6).
 *
 *   loading → refused | unavailable
 *           → looking-for-agent → no-agent ⇄ (retry) looking-for-agent
 *                               → no-identity → confirm-phrase → beginning
 *                               → beginning → consent → returning
 *                                                     → cancelled
 *           failed (any step), restartable ones begin a new attempt for the same link
 */
import type { AllowlistedClient, SignInBeginResponse } from './issuer-wire';
import type { LinkRefusal, SignInLink } from './link';

/** What every step after the link was accepted knows. */
export interface Accepted {
  link: SignInLink;
  client: AllowlistedClient;
  /** The match phrase, recomputed from the link's challenge. */
  words: [string, string, string];
}

export type SignInState =
  | { step: 'loading' }
  | { step: 'refused'; reason: LinkRefusal }
  | { step: 'unavailable'; code: string }
  | ({ step: 'looking-for-agent' } & Accepted)
  | ({ step: 'no-agent' } & Accepted)
  | ({ step: 'no-identity'; busy: boolean; error: string | null } & Accepted)
  | ({ step: 'confirm-phrase'; idFp: string; phrase: string[]; checks: number[]; error: string | null } & Accepted)
  | ({ step: 'beginning'; idFp: string } & Accepted)
  | ({ step: 'consent'; idFp: string; begun: SignInBeginResponse; busy: boolean; error: string | null } & Accepted)
  | ({ step: 'returning'; action: string } & Accepted)
  | { step: 'cancelled' }
  | ({ step: 'failed'; code: string; restartable: boolean } & Accepted);

export type SignInStep = SignInState['step'];

/** Why an Approve stayed in the dialog rather than ending the attempt. */
export const ANSWERABLE_IN_DIALOG: ReadonlySet<string> = new Set(['wrong_password', 'rate_limited']);

/** Issuer refusals that end this attempt but not the link: a new `begin` for it can succeed. */
export const RESTARTABLE: ReadonlySet<string> = new Set(['attempt_expired', 'unknown_attempt', 'attempt_proven', 'agent_lost']);
