/**
 * localStorage-backed recent-servers list.
 *
 * Owns the offline/fallback store the Connect page reads when the WASM client
 * (and thus LocalDB) is unavailable: most-recent-first ordering and the size
 * cap. Split from server-utils.ts so the LocalDB request plumbing and this
 * browser-storage fallback are separate responsibilities; server-utils
 * re-exports these, so import sites are unaffected.
 */

import { debugLog } from '@/lib/debug-config';
import type { StoredServer } from './server-utils';

const RECENT_SERVERS_KEY: "citadel_recent_servers" = 'citadel_recent_servers';

/**
 * How many servers to remember.
 *
 * This is a convenience list on the connect screen, not a record — beyond a
 * handful, scrolling to find one is slower than typing the address. Capping it
 * also stops localStorage growing for the lifetime of the install.
 */
const MAX_RECENT_SERVERS: number = 10;

/**
 * Save a server to localStorage for offline/fallback access.
 * Called during auth flow so Connect page always has data.
 */
export function saveRecentServer(server: StoredServer): void {
  try {
    const existing: StoredServer[] = getRecentServers().filter(
      s => s.serverAddress !== server.serverAddress
    );

    // Most recent first, and capped. The list is called "recent" and is shown to
    // the user in order, but entries used to be appended in first-seen order and
    // never removed — so the oldest server sat at the top forever and the list
    // grew without limit.
    const updated: StoredServer[] = [{ ...server, lastConnected: Date.now() }, ...existing].slice(
      0,
      MAX_RECENT_SERVERS
    );

    localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(updated));
  } catch (e) {
    debugLog('ServerUtils', 'Error saving recent server to localStorage:', e);
  }
}

/**
 * Get recent servers from localStorage (fallback when WASM client unavailable).
 */
export function getRecentServers(): StoredServer[] {
  try {
    const raw: string | null = localStorage.getItem(RECENT_SERVERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
