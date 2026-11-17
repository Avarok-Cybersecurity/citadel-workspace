/**
 * A link that opens Citadel Workspace AT one of the agent's accounts.
 *
 * The native menu-bar app lists the accounts the local agent holds and opens
 * the app on one of them. Two spellings reach the landing page:
 *
 *   /?account=<username>[&server=<host[:port]>]
 *   /?link=web+citadel://open?account=<username>[&server=<host[:port]>]
 *
 * The second is what the manifest's `protocol_handlers` entry substitutes for
 * `%s`: an installed PWA's shim drops plain https URLs handed to it by a native
 * app, and only a registered scheme gets through. Both are read by the same
 * validator.
 *
 * The link SELECTS, it never authenticates. It carries a username and, at most,
 * a server address -- nothing secret, and no redirect target. What it may lead
 * to is decided elsewhere: claiming a session this browser's agent already
 * holds, or the sign-in form with the username filled in and the password left
 * for the user.
 *
 * Anything that is not exactly one of those shapes is refused whole rather than
 * partly honoured: a link with an extra parameter is not a link we understand.
 */
import { validateUsername } from '@/lib/credential-rules';
import { isWorkspaceServerShape } from '@/lib/default-workspace-server';
import { parseLinkTarget, type LinkTarget } from './link-target';

export interface AccountLink {
  readonly username: string;
  readonly server?: string;
  /** What to open there (link-target.ts). */
  readonly open?: LinkTarget;
}

/** Every query key this module owns, so the page can clear them after reading. */

export const ACCOUNT_LINK_SCHEME: string = 'web+citadel:';

/** The one action the scheme names: `web+citadel://open?...`. */
const LINK_ACTION: string = 'open';

/** Generous for `web+citadel://open?account=<37 bytes, escaped>&server=<host:port>`. */
const MAX_LINK_LENGTH: number = 512;

/** A DNS name is at most 253 characters; `:65535` adds six. */
const MAX_SERVER_LENGTH: number = 259;

/**
 * Whitespace, control and format characters (bidi overrides, zero-width
 * joiners). The registration rule refuses only the ASCII space; these would
 * let a link render one username while naming another.
 */
const INVISIBLE_OR_CONTROL: RegExp = /[\s\p{Cc}\p{Cf}]/u;

function keysOf(params: URLSearchParams): string[] {
  return Array.from(params.keys());
}

/** Exactly `account`, with at most one `server` and one `open`. */
function parseAccountParams(params: URLSearchParams): AccountLink | null {
  const keys: string[] = keysOf(params);
  const allowed: boolean =
    keys.every((key: string) => key === 'account' || key === 'server' || key === 'open') &&
    params.getAll('account').length === 1 &&
    params.getAll('server').length <= 1 &&
    params.getAll('open').length <= 1;
  if (!allowed) return null;

  const username: string = params.get('account') ?? '';
  if (validateUsername(username) !== null || INVISIBLE_OR_CONTROL.test(username)) return null;

  const raw: string | null = params.get('open');
  const open: LinkTarget | null = raw === null ? null : parseLinkTarget(raw);
  if (raw !== null && open === null) return null;
  const target: { open?: LinkTarget } = open ? { open } : {};

  const server: string | null = params.get('server');
  if (server === null) return { username, ...target };
  if (server.length > MAX_SERVER_LENGTH || !isWorkspaceServerShape(server)) return null;
  return { username, server, ...target };
}

/** `web+citadel://open?account=...[&server=...]`, and nothing more. */
function parseSchemeLink(raw: string): AccountLink | null {
  if (raw.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const bare: boolean =
    url.protocol === ACCOUNT_LINK_SCHEME &&
    url.hostname === LINK_ACTION &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    (url.pathname === '' || url.pathname === '/') &&
    url.hash === '';
  return bare ? parseAccountParams(url.searchParams) : null;
}

/**
 * The account a landing-page URL asks to be opened at, or null.
 *
 * Null for a URL with none of the link's parameters AND for one that has them
 * wrong; the caller clears `ACCOUNT_LINK_PARAMS` either way.
 */
export function parseAccountLink(params: URLSearchParams): AccountLink | null {
  const keys: string[] = keysOf(params);
  if (keys.includes('link')) {
    if (keys.length !== 1 || params.getAll('link').length !== 1) return null;
    return parseSchemeLink(params.get('link') ?? '');
  }
  if (!keys.includes('account')) return null;
  return parseAccountParams(params);
}

/**
 * The landing-page path that opens `link`, the inverse of `parseAccountLink`.
 * A server this parser would refuse is left out rather than sent, so the link
 * still opens sign-in for the account instead of being refused whole.
 */
export function accountLinkPath(link: AccountLink): string {
  const params: URLSearchParams = new URLSearchParams({ account: link.username });
  if (link.server !== undefined && link.server.length <= MAX_SERVER_LENGTH && isWorkspaceServerShape(link.server)) {
    params.set('server', link.server);
  }
  return `/?${params.toString()}`;
}

export { ACCOUNT_LINK_PARAMS, hasAccountLinkParams } from './account-link-params';
