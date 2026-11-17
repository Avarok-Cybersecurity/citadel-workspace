/**
 * Waiting for a permissions load to land, without leaking a listener.
 *
 * `off('user:permissions:loaded', handler)` was called only on the success
 * path. A fetch that timed out therefore left its listener on the global
 * emitter for the life of the tab — one per timed-out fetch, each holding its
 * closure and its `reject` alive, and each still running on every subsequent
 * permissions load for as long as the tab was open.
 *
 * Extracted because the lifetime is the whole substance: the handler has to be
 * declared before the timeout so the timeout can remove it, which reads as a
 * mistake inline and is the point here.
 *
 * It waits on `permissions:updated` -- "the cache now holds this domain" --
 * and NOT on `user:permissions:loaded`, which is only "a response arrived".
 *
 * The two are not the same moment. The service fills the cache from that
 * response synchronously when it can read the current user id without awaiting,
 * and inside a `.then` when it cannot -- a path whose own comment says it
 * exists because the synchronous accessor is null for a user who logged IN
 * rather than registering. So for anybody who logged in, the cache was filled a
 * tick after the event this used to wait on, and the read here had already
 * happened and rejected:
 *
 *   Error: Permissions not found in cache after load
 *
 * printed over and over in `test:prev-sessions`, which logs in. Even on the
 * synchronous path it worked only because the service's listener happened to be
 * registered first: waiting on "a response arrived" and then reading something
 * a different listener fills makes the answer depend on listener order.
 */

import { eventEmitter } from '@/lib/event-emitter';
import { TIMEOUT } from '@/lib/timeout-constants';
import type { DomainPermissions } from './types';

/**
 * `askedAt` is when the request went out. An answer that landed before this was called
 * -- the response can beat the caller here, measured live -- is already in the cache and
 * is taken at once, provided it is at least that fresh; an older entry is what the
 * request was sent to replace, so it is not an answer.
 */
export function awaitPermissionsLoaded(
  domainId: string,
  readCache: () => DomainPermissions | undefined,
  askedAt: number,
): Promise<DomainPermissions> {
  const landed: DomainPermissions | undefined = readCache();
  if (landed && landed.lastUpdated >= askedAt) return Promise.resolve(landed);
  return new Promise<DomainPermissions>((resolve, reject) => {
    // The timeout closes over `handler`, which is declared below it. That is
    // safe and not a hoisting trick: the callback body does not evaluate the
    // binding until the timer fires, and by then the const is initialised. The
    // order matters the other way round -- the timeout must be able to remove
    // the handler, which is the whole fix.
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      eventEmitter.off('permissions:updated', handler);
      reject(new Error('Permission fetch timeout'));
    }, TIMEOUT.PERMISSION_FETCH_MS);

    const handler = (payload: { domainId: string }): void => {
      if (payload.domainId !== domainId) return;

      const cached: DomainPermissions | undefined = readCache();
      // The event says the cache holds this domain. If it does not, something
      // else emitted it -- stay listening rather than concluding, because the
      // real fill may still be coming and the timeout is what decides when to
      // give up.
      if (!cached) return;

      clearTimeout(timeout);
      eventEmitter.off('permissions:updated', handler);
      resolve(cached);
    };

    eventEmitter.on('permissions:updated', handler);
  });
}
