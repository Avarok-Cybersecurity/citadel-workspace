import { useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import WorkspaceService from '@/lib/workspace-service';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '@/lib/timeout-constants';

export type PermissionsLoad =
  | { status: 'loading' }
  | { status: 'loaded'; permissions: Set<string>; role: string; roleId: string | null }
  | { status: 'failed'; reason: string };

const LOADING: PermissionsLoad = { status: 'loading' };

/**
 * What the SERVER currently grants this user at each of several levels, keyed
 * by domain id -- one request per level, each settling on its own. The server
 * reports what enforcement allows at each level (inheritance included), so a
 * level's answer is the member's EFFECTIVE permissions there.
 *
 * The permission editor used to call `getUserPermissions` and discard the
 * result — even on success. Nothing ever wrote the response into state, so the
 * matrix always rendered `getRoleDefaultPermissions()` constants, and Save
 * diffed the admin's edits against those same client-side defaults rather than
 * against what the server actually had. An admin "reviewing" permissions was
 * reading fiction, and saving pushed the defaults over whatever the server was
 * really enforcing: a silent reset, or a silent escalation.
 *
 * So this hook exists to make the read side real, and to make the three states
 * distinguishable — because "still loading" and "failed to load" both used to
 * look exactly like "these are the permissions".
 */
export function useLoadedPermissionsAt(userId: string, domainIds: readonly string[]): Readonly<Record<string, PermissionsLoad>> {
  const [loads, setLoads] = useState<Record<string, PermissionsLoad>>({});
  // By value: a caller's fresh array of the same ids is the same request.
  const key: string = domainIds.join('\u0000');

  useEffect(() => {
    const ids: string[] = key === '' ? [] : key.split('\u0000');
    setLoads(Object.fromEntries(ids.map((id: string): [string, PermissionsLoad] => [id, LOADING])));
    const settled: Set<string> = new Set();
    const settle = (domainId: string, load: PermissionsLoad): void => {
      settled.add(domainId);
      setLoads((prev: Record<string, PermissionsLoad>): Record<string, PermissionsLoad> => ({ ...prev, [domainId]: load }));
    };

    const onLoaded = (payload: {
      userId: string;
      domainId: string;
      role: string;
      /** Absent from a payload that predates the role table. */
      roleId?: string | null;
      permissions: string[];
    }): void => {
      // Both, because one editor can be open while another domain's response
      // arrives — and the response is the only thing that says which is which.
      if (payload.userId !== userId || !ids.includes(payload.domainId)) return;
      settle(payload.domainId, { status: 'loaded', permissions: new Set(payload.permissions), role: payload.role, roleId: payload.roleId ?? null });
    };

    const unsubscribe: () => void = eventEmitter.on('user:permissions:loaded', onLoaded);

    const timer: NodeJS.Timeout = setTimeout((): void => {
      // A silent timeout would leave the editor showing defaults for ever,
      // which is exactly the state this hook exists to make impossible.
      for (const id of ids) {
        if (!settled.has(id)) settle(id, { status: 'failed', reason: 'The server did not answer. These may not be the current permissions.' });
      }
    }, TIMEOUT.PERMISSION_FETCH_MS);

    for (const id of ids) {
      runAsyncSetup(async () => {
        try {
          await WorkspaceService.getUserPermissions(userId, id);
        } catch (error) {
          debugLog('PermissionManager', 'Error loading permissions:', error);
          // An answer already in is the server's word; a late failure to send cannot unsay it.
          if (!settled.has(id)) settle(id, { status: 'failed', reason: error instanceof Error ? error.message : 'Could not load permissions.' });
        }
      });
    }

    return (): void => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [userId, key]);

  return loads;
}
