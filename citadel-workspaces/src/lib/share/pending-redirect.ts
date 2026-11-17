/**
 * A secure link being opened: `/?redirect=<token>&server=<addr>`, held across sign-in.
 *
 * Captured once, at boot, before the landing page or the workspace loader read the address:
 * the account-link parser refuses any URL with keys it does not know (account-link.ts), and the
 * loader replaces the address on its way to /workspace. The pair goes into sessionStorage so a
 * reload during sign-in keeps it, the two keys come out of the address so nothing else acts on
 * them, and it is taken -- read and removed -- exactly once when a session is ready to resolve it.
 *
 * The URL carries only the token and the server: nothing in it says where the link points.
 */
import { isWorkspaceServerShape } from '@/lib/default-workspace-server';
import type { HandoffStorage } from '@/lib/chat/draft-handoff';

export const REDIRECT_PARAM: 'redirect' = 'redirect';
export const SERVER_PARAM: 'server' = 'server';
const STORAGE_KEY: string = 'citadel.share.pending-redirect';

/** 32 random bytes, base64url without padding, as the server mints them. */
const TOKEN_SHAPE: RegExp = /^[A-Za-z0-9_-]{43}$/;
/** A DNS name is at most 253 characters; `:65535` adds six. */
const MAX_SERVER_LENGTH: number = 259;

export interface PendingRedirect {
  token: string;
  server: string;
}

export type RedirectStorage = HandoffStorage;

/** Where `capturePendingRedirect` keeps the link when storage refuses it: this load only. */
let inMemory: PendingRedirect | null = null;

/** The link a query string opens: exactly one well-formed `redirect` and one `server`, or null. */
export function readRedirectParams(params: URLSearchParams): PendingRedirect | null {
  const keys: string[] = Array.from(params.keys());
  if (keys.length !== 2 || params.getAll(REDIRECT_PARAM).length !== 1 || params.getAll(SERVER_PARAM).length !== 1) return null;
  const token: string = params.get(REDIRECT_PARAM) ?? '';
  const server: string = params.get(SERVER_PARAM) ?? '';
  if (!TOKEN_SHAPE.test(token) || server.length > MAX_SERVER_LENGTH || !isWorkspaceServerShape(server)) return null;
  return { token, server };
}

/** The absolute link that opens `token` on `server`: the inverse of `readRedirectParams`. */
export function secureLinkUrl(origin: string, token: string, server: string): string {
  return `${origin}/?${new URLSearchParams({ [REDIRECT_PARAM]: token, [SERVER_PARAM]: server }).toString()}`;
}

function store(storage: RedirectStorage | null, pending: PendingRedirect): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, `${pending.token}\n${pending.server}`);
    return true;
  } catch {
    return false;
  }
}

function read(storage: RedirectStorage | null): PendingRedirect | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const [token, server, ...rest] = raw.split('\n');
  if (rest.length > 0 || server === undefined) return null;
  return readRedirectParams(new URLSearchParams({ [REDIRECT_PARAM]: token, [SERVER_PARAM]: server }));
}

function forget(storage: RedirectStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget where storage cannot be reached.
  }
}

/**
 * At boot: if the address opens a secure link, keep it and take its keys out of the address.
 * `replaceSearch` receives the query string to put back (without the leading `?`). A malformed
 * link is dropped from the address as well, and nothing is kept.
 */
export function capturePendingRedirect(search: string, storage: RedirectStorage | null, replaceSearch: (search: string) => void): PendingRedirect | null {
  const params: URLSearchParams = new URLSearchParams(search);
  if (!params.has(REDIRECT_PARAM)) return null;
  const pending: PendingRedirect | null = readRedirectParams(params);
  params.delete(REDIRECT_PARAM);
  params.delete(SERVER_PARAM);
  replaceSearch(params.toString());
  if (pending === null) return null;
  inMemory = store(storage, pending) ? null : pending;
  return pending;
}

/** The link waiting to be opened, left in place. */
export function peekPendingRedirect(storage: RedirectStorage | null): PendingRedirect | null {
  return inMemory ?? read(storage);
}

/** The link waiting to be opened, removed so it is opened once. */
export function takePendingRedirect(storage: RedirectStorage | null): PendingRedirect | null {
  const pending: PendingRedirect | null = peekPendingRedirect(storage);
  inMemory = null;
  forget(storage);
  return pending;
}

