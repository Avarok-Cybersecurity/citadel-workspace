/**
 * The boot half of an app link (app-link.ts): on `/workspace` with an `app` key, the query is kept
 * as it came, for the sign-in reload, and the link's keys leave the address. Nothing is judged
 * here, so the landing page carries no app rules: the strict reading happens when the link is
 * taken (app-link.ts, which also reads it back), and a malformed one is dropped then.
 */
import type { HandoffStorage } from '@/lib/chat/draft-handoff';

export const APP_LINK_PATH: string = '/workspace';
export const APP_PARAM: 'app' = 'app';
export const APP_LINK_KEYS: readonly string[] = [APP_PARAM, 'scope', 'v', 'server'];
export const APP_LINK_STORAGE_KEY: string = 'citadel.apps.pending-link';

/** Where `captureAppLink` keeps the query when storage refuses it: this load only. */
export const keptInMemory: { query: string | null } = { query: null };

/**
 * At boot: keep `/workspace?app=…`'s whole query and take the link's keys out of the address.
 * `replaceSearch` receives the query string to put back (without the `?`).
 */
export function captureAppLink(pathname: string, search: string, storage: HandoffStorage | null, replaceSearch: (search: string) => void): void {
  const params: URLSearchParams = new URLSearchParams(search);
  if (pathname !== APP_LINK_PATH || !params.has(APP_PARAM)) return;
  const kept: string = params.toString();
  for (const key of APP_LINK_KEYS) params.delete(key);
  replaceSearch(params.toString());
  keptInMemory.query = kept;
  if (storage === null) return;
  try {
    storage.setItem(APP_LINK_STORAGE_KEY, kept);
    keptInMemory.query = null;
  } catch {
    // Storage refused it: the copy in memory serves this load.
  }
}
