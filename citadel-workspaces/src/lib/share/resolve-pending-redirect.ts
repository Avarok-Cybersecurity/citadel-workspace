/**
 * After sign-in: open the secure link the visitor arrived with, or go where sign-in goes anyway.
 *
 * Every success path -- the landing page's join and sign-in, the connect page, the switch to an
 * existing session, and the workspace loader once its session is up -- comes through here, so a
 * link survives whichever way the visitor got in. It is resolved through this tab's session, and
 * only when that session is on the server the link names; the target the server answers with is
 * checked again (target-rules.ts) before it is navigated to. Anything else is the one answer,
 * "This link isn't available to you", the same for unknown, expired, used up and not for you.
 */
import { sessionIsOnServer } from '@/lib/sessions/same-server';
import { getWorkspacePath } from '@/lib/workspace-navigation';
import type { PendingRedirect } from './pending-redirect';
import { validateShareTarget } from './target-rules';
import type { ResolveOutcome } from '@/lib/workspace-service/secure-links-operations';

export interface RedirectDeps {
  peek: () => PendingRedirect | null;
  take: () => PendingRedirect | null;
  /** Whether this tab's session can carry a request yet. */
  ready: () => boolean;
  /** The server this tab's session is on, or null when it is not known. */
  sessionServer: () => Promise<string | null>;
  resolve: (token: string) => Promise<ResolveOutcome>;
  navigate: (path: string) => void;
  unavailable: (detail: string) => void;
}

export const UNAVAILABLE_COPY: { title: string; generic: string; otherServer: (server: string) => string } = {
  title: "This link isn't available to you",
  generic: 'It may have expired or been used, or it was made for someone else.',
  otherServer: (server: string): string => `It belongs to the workspace at ${server}. Sign in to an account there to open it.`,
};

/**
 * `fallback` is where to go when there is no link to open, or it cannot be opened: the workspace
 * for a sign-in path, null for the loader, which is already there. A session not yet ready leaves
 * the link waiting for the loader, which calls this again once it is.
 */
export async function resolvePendingRedirectWith(deps: RedirectDeps, fallback: string | null): Promise<void> {
  const go = (path: string | null): void => { if (path !== null) deps.navigate(path); };
  if (deps.peek() === null || !deps.ready()) { go(fallback); return; }
  const pending: PendingRedirect | null = deps.take();
  if (pending === null) { go(fallback); return; }

  const server: string | null = await deps.sessionServer();
  if (server === null || !sessionIsOnServer({ server_address: server }, pending.server)) {
    deps.unavailable(UNAVAILABLE_COPY.otherServer(pending.server));
    go(fallback);
    return;
  }

  let outcome: ResolveOutcome;
  try {
    outcome = await deps.resolve(pending.token);
  } catch {
    outcome = { kind: 'unavailable' };
  }
  if (outcome.kind === 'resolved' && validateShareTarget(outcome.target)) {
    deps.navigate(outcome.target);
    return;
  }
  deps.unavailable(UNAVAILABLE_COPY.generic);
  // From the loader the visitor is in the workspace already; elsewhere the fallback is it.
  deps.navigate(fallback ?? getWorkspacePath());
}
