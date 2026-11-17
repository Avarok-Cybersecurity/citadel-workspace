/**
 * A link that opens an app's listing: `/workspace?app=<id>[&scope=node:<nodeId>][&v=<version>]
 * [&server=<addr>]`, on this origin, so chat and documents already classify it as `internal`
 * (document-links.ts) and no new scheme exists.
 *
 * Captured at boot like a secure link (share/pending-redirect.ts), by app-link-capture.ts: its keys
 * leave the address, the query waits in sessionStorage through the sign-in reload, and it is taken
 * -- read strictly here and removed -- once, when a workspace session is up to open the marketplace
 * on it. A malformed link is dropped when taken.
 */
import { isWorkspaceServerShape } from '@/lib/default-workspace-server';
import type { HandoffStorage } from '@/lib/chat/draft-handoff';
import { isAppId, isScopeId, parseAppVersion } from './app-identity';
import { APP_LINK_KEYS, APP_LINK_PATH, APP_PARAM, APP_LINK_STORAGE_KEY, keptInMemory } from './app-link-capture';

export { APP_LINK_PATH, APP_PARAM };
const [, SCOPE_PARAM, VERSION_PARAM, SERVER_PARAM] = APP_LINK_KEYS;
const KNOWN: readonly string[] = APP_LINK_KEYS;
const NODE_SCOPE_PREFIX: string = 'node:';
/** A DNS name is at most 253 characters; `:65535` adds six. */
const MAX_SERVER_LENGTH: number = 259;

export interface AppLink {
  appId: string;
  /** The page the install is suggested for, from `scope=node:<id>`. */
  nodeId: string | null;
  version: string | null;
  server: string | null;
}

/** The link a query string opens: only the four keys, each at most once, `app` required. */
export function readAppLinkParams(params: URLSearchParams): AppLink | null {
  const keys: string[] = Array.from(params.keys());
  if (keys.some((k: string) => !KNOWN.includes(k)) || KNOWN.some((k: string) => params.getAll(k).length > 1)) return null;
  const appId: string | null = params.get(APP_PARAM);
  if (appId === null || !isAppId(appId)) return null;
  const scope: string | null = params.get(SCOPE_PARAM);
  const nodeId: string | null = scope === null ? null : scope.startsWith(NODE_SCOPE_PREFIX) ? scope.slice(NODE_SCOPE_PREFIX.length) : '';
  if (nodeId !== null && !isScopeId(nodeId)) return null;
  const version: string | null = params.get(VERSION_PARAM);
  if (version !== null && parseAppVersion(version) === null) return null;
  const server: string | null = params.get(SERVER_PARAM);
  if (server !== null && (server.length > MAX_SERVER_LENGTH || !isWorkspaceServerShape(server))) return null;
  return { appId, nodeId, version, server };
}

/** The query string (no `?`) for `link`: `readAppLinkParams`'s inverse. */
export function appLinkSearch(link: AppLink): string {
  const params: URLSearchParams = new URLSearchParams({ [APP_PARAM]: link.appId });
  if (link.nodeId !== null) params.set(SCOPE_PARAM, `${NODE_SCOPE_PREFIX}${link.nodeId}`);
  if (link.version !== null) params.set(VERSION_PARAM, link.version);
  if (link.server !== null) params.set(SERVER_PARAM, link.server);
  return params.toString();
}

/** The absolute link to share: the form chat and documents carry. */
export function appLinkUrl(origin: string, link: AppLink): string {
  return `${origin}${APP_LINK_PATH}?${appLinkSearch(link)}`;
}

function peekKeptAppQuery(storage: HandoffStorage | null): string | null {
  if (keptInMemory.query !== null) return keptInMemory.query;
  try {
    return storage === null ? null : storage.getItem(APP_LINK_STORAGE_KEY);
  } catch {
    return null;
  }
}

function takeKeptAppQuery(storage: HandoffStorage | null): string | null {
  const kept: string | null = peekKeptAppQuery(storage);
  keptInMemory.query = null;
  try {
    storage?.removeItem(APP_LINK_STORAGE_KEY);
  } catch {
    // Nothing to remove where storage cannot be reached.
  }
  return kept;
}

/** The link kept at boot (app-link-capture.ts), read strictly; a malformed one is null. */
export function peekAppLink(storage: HandoffStorage | null): AppLink | null {
  const kept: string | null = peekKeptAppQuery(storage);
  return kept === null ? null : readAppLinkParams(new URLSearchParams(kept));
}

/** The waiting link, removed so it opens once (a malformed one is removed too). */
export function takeAppLink(storage: HandoffStorage | null): AppLink | null {
  const kept: string | null = takeKeptAppQuery(storage);
  return kept === null ? null : readAppLinkParams(new URLSearchParams(kept));
}
