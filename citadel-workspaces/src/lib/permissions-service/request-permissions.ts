/**
 * One permissions fetch for a domain: ask the server, then wait for the answer
 * to land in the cache.
 *
 * Split out of service.ts, which was over the 250-line cap. The service owns the
 * maps; this is the request it deduplicates through `pendingRequests`.
 */

import { awaitPermissionsLoaded } from './await-permissions-loaded';
import WorkspaceService from '@/lib/workspace-service';
import type { DomainPermissions } from './types';

export function requestPermissions(
  domainId: string,
  userId: string,
  cache: Map<string, DomainPermissions>,
  lastFailure: Map<string, string>,
  pendingRequests: Map<string, Promise<DomainPermissions>>,
): Promise<DomainPermissions> {
  return (async (): Promise<DomainPermissions> => {
    try {
      const askedAt: number = Date.now();
      await WorkspaceService.getUserPermissions(userId, domainId);

      const loaded: DomainPermissions = await awaitPermissionsLoaded(domainId, () =>
        cache.get(domainId),
      askedAt);
      lastFailure.delete(domainId);
      return loaded;
    } catch (error: unknown) {
      // The message, and who it was asked for. A permissions answer that
      // never arrives and one that arrives for somebody else are the same
      // silence here, and only the user id tells them apart.
      const reason: string = error instanceof Error ? error.message : 'the request failed';
      lastFailure.set(domainId, `${reason} (asked as ${userId})`);
      throw error;
    } finally {
      pendingRequests.delete(domainId);
    }
  })();
}
