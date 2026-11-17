/**
 * What an account link does once parsed: switch to a session this browser's
 * agent already holds, or open sign-in with the username filled in.
 *
 * Nothing else. The link carries no secret, so it can never authenticate by
 * itself: the only session it can reach is one the agent reports as live, and
 * that goes through the same switch the Active Sessions strip uses -- claim
 * refusal ("open in another tab") included. Every other outcome, an unanswered
 * session query among them, is the sign-in form waiting for a password.
 *
 * I/O arrives through `AccountLinkIO` so the decision can be tested without a
 * connection manager.
 */
import { sessionIsOnServer } from '@/lib/sessions/same-server';
import type { AccountLink } from './account-link';

/** The fields of a live session the decision reads. */
export interface LinkableSession {
  username: string;
  server_address: string;
  server_host?: string | null;
}

export type AccountLinkDecision<T extends LinkableSession> =
  | { readonly kind: 'switch'; readonly session: T }
  /** `server`: the link's own, which the sign-in is scoped to; null when the link names none. */
  | { readonly kind: 'login'; readonly username: string; readonly server: string | null };

export interface AccountLinkIO<T extends LinkableSession> {
  /** `ok: false` when the agent never answered -- not the same as "none". */
  listSessions: () => Promise<{ ok: boolean; sessions: readonly T[] }>;
  /**
   * Resolves when sign-in must open without waiting any longer for `listSessions`. The agent
   * can be unreachable for as long as a permission prompt stays unanswered (Brave's "Access
   * other apps and services on this device"), and the link used to wait on it for ever.
   */
  signInDeadline: () => Promise<void>;
  switchTo: (session: T) => Promise<void>;
  login: (username: string, server: string | null) => void;
}


/**
 * The one session the link names, or sign-in.
 *
 * Two live sessions with the link's username and no server to tell them apart
 * is not a match: choosing one would be a guess about which account the user
 * meant.
 */
export function decideAccountLink<T extends LinkableSession>(
  link: AccountLink,
  sessions: readonly T[],
): AccountLinkDecision<T> {
  const matches: T[] = sessions.filter(
    (session: T) =>
      session.username === link.username &&
      (link.server === undefined || sessionIsOnServer(session, link.server)),
  );
  const only: T | undefined = matches.length === 1 ? matches[0] : undefined;
  return only ? { kind: 'switch', session: only } : { kind: 'login', username: link.username, server: link.server ?? null };
}

/**
 * Sign-in opens with the link's username as soon as the deadline passes without an answer.
 * A late answer that shows the account live still switches to it; otherwise the sign-in
 * already open is the outcome, and it is not opened twice.
 */
export async function openAccountLink<T extends LinkableSession>(
  link: AccountLink,
  io: AccountLinkIO<T>,
): Promise<AccountLinkDecision<T>> {
  type Answer = { ok: boolean; sessions: readonly T[] };
  const answered: Promise<Answer> = io.listSessions();
  const first: Answer | 'deadline' = await Promise.race([
    answered,
    io.signInDeadline().then((): 'deadline' => 'deadline'),
  ]);
  const signedInEarly: boolean = first === 'deadline';
  if (signedInEarly) io.login(link.username, link.server ?? null);
  const { ok, sessions }: Answer = first === 'deadline' ? await answered : first;
  const decision: AccountLinkDecision<T> = decideAccountLink(link, ok ? sessions : []);
  if (decision.kind === 'switch') await io.switchTo(decision.session);
  else if (!signedInEarly) io.login(decision.username, decision.server);
  return decision;
}
