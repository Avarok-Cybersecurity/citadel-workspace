/**
 * The workspace a sign-in form's account is on, for its human check: the token
 * must be bound to that workspace (account-servers.ts). Asked of the agent once
 * per form; `undefined` until it answers, and for an account it has no host for.
 *
 * In order: the host the agent recorded for the account; else the tenant this
 * device remembers for it (a sign-in hint); else the workspace this page is
 * served from (`acme.work.avarok.net`). With none of them, the check asks the
 * user for the address (AdmissionCheck) rather than render a token the server
 * would refuse.
 */
import { useEffect, useState } from 'react';
import { browserAccountServers, browserPageWorkspace } from '@/lib/admission';
import type { SignInHint } from '@/lib/sign-in';

/** The agent's host, else this device's only hint for that name, else the page's own workspace. */
export function accountWorkspace(
  username: string, agentHosts: ReadonlyMap<string, string>, hints: readonly SignInHint[], page: string | undefined,
): string | undefined {
  const name: string = username.trim();
  const host: string | undefined = agentHosts.get(name);
  if (host !== undefined) return host;
  const remembered: readonly SignInHint[] = hints.filter((hint: SignInHint) => hint.username === name);
  // Two workspaces remember this name: which one is meant is not this page's guess.
  if (remembered.length === 1) return remembered[0].tenant;
  return name ? page : undefined;
}

export function useAccountServer(username: string, hints: readonly SignInHint[]): string | undefined {
  const [servers, setServers] = useState<ReadonlyMap<string, string>>(new Map<string, string>());
  useEffect((): (() => void) => {
    let live: boolean = true;
    browserAccountServers().then((found: ReadonlyMap<string, string>): void => { if (live) setServers(found); }, (): void => undefined);
    return (): void => { live = false; };
  }, []);
  return accountWorkspace(username, servers, hints, browserPageWorkspace());
}
