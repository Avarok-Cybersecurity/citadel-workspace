/**
 * Whether the browser lets this page reach the agent on this device.
 *
 * Chrome asks before a website may connect to the loopback interface ("Local Network
 * Access"). Until the visitor answers, the page's WebSocket to the agent cannot open; if
 * they decline, it fails exactly as an agent that is not running does. Measured on Chrome
 * 153 against a running agent: the page said "Connection Failed ... Download Citadel",
 * which sends someone with a working agent to reinstall it.
 *
 * Chrome 153 names the permission `loopback-network` (split from the earlier
 * `local-network-access`); both are tried, newest first. A browser that knows neither has
 * no such gate, which is `unknown` here: nothing to explain.
 */
export type LoopbackAccess = 'granted' | 'prompt' | 'denied' | 'unknown';

export const LOOPBACK_PERMISSION_NAMES: readonly string[] = ['loopback-network', 'local-network-access'];

export interface LoopbackAccessReading {
  state: LoopbackAccess;
  /** The live status to watch for changes; null when the browser has no such permission. */
  status: PermissionStatus | null;
}

export async function readLoopbackAccess(permissions: Permissions | undefined): Promise<LoopbackAccessReading> {
  if (!permissions) return { state: 'unknown', status: null };
  for (const name of LOOPBACK_PERMISSION_NAMES) {
    try {
      // The DOM typings list only the permission names they know; these are newer.
      const status: PermissionStatus = await permissions.query({ name } as unknown as PermissionDescriptor);
      return { state: status.state, status };
    } catch {
      // This browser does not know that name; try the next.
    }
  }
  return { state: 'unknown', status: null };
}
