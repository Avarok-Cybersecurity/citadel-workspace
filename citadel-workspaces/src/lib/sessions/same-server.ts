import { normalizeWorkspaceAddress } from '@/lib/workspace-address';

/** What the agent reports about where a session is connected. */
export interface SessionServer {
  server_address: string;
  /** The address as the user typed it; absent from agents older than the field. */
  server_host?: string | null;
}

/**
 * Whether a session belongs to the workspace server at `address` (as the UI stores it).
 *
 * The agent's `server_address` is how it DIALLED: `wss://bench.work.avarok.net/` for a
 * hosted workspace, a resolved address for others. The UI stores what the user typed
 * (`bench.work.avarok.net`). Compared directly they never matched for a hosted workspace —
 * measured on the live site — so reconnect, the connect page, the login redirect, workspace
 * names, the account dialog and account links all treated a live hosted session as absent.
 * `server_host` is the agent's record of the typed address, and is compared instead when
 * the agent sends it.
 */
export function sessionIsOnServer(session: SessionServer, address: string): boolean {
  return sameAddress(session.server_host ?? session.server_address, address);
}

/** Whether two addresses, as typed or as dialled, name the same workspace server. */
export function sameAddress(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

/**
 * A dialled `ws(s)://` URL reduced to the host it names, so it compares equal to the typed
 * host. Without this, a session reported with no `server_host` (one the agent re-created)
 * matched nothing. The scheme's own port is dropped; any other port stays significant.
 * Anything that is not such a URL is returned trimmed.
 */
export function dialledHost(address: string): string {
  const trimmed: string = address.trim();
  if (!/^wss?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url: URL = new URL(trimmed);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return trimmed;
  }
}

/** The host the agent says a session is on: what was typed, else the dialled URL's host. */
export function sessionHost(session: SessionServer): string {
  return session.server_host?.trim() || dialledHost(session.server_address);
}

function canonical(address: string): string {
  return normalizeWorkspaceAddress(dialledHost(address)).toLowerCase();
}
