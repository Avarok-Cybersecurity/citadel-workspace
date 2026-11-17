/**
 * The LocalDB client this store uses, and the read-tracking that makes its
 * writes safe.
 *
 * Split out of `persistence.ts` when that file passed the 250-line cap. The
 * public load/persist functions stayed there; what moved is the generic
 * get/set pair and the record of which keys have actually been read.
 *
 * Keeping them together is the point: the guard in `localDBSet` is only
 * meaningful because `localDBGet` is the one thing that marks a key read, and
 * a reviewer changing either needs to see both.
 */
import { websocketService } from '../websocket-service';
import { debugLog } from '@/lib/debug-config';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { failOnSocketLoss } from '@/lib/websocket/request-response';
import { stringToBytes } from '../utils/encoding-utils';
import type { KVPendingEntry } from './types';
import { REQUEST_TIMEOUT_MS } from './constants';

/**
 * Keys whose contents have actually been read into memory.
 *
 * Every write in this module writes a WHOLE list. That is only sound when the
 * list in memory is a faithful copy of the key, which is true only if the key
 * was read. If the read failed -- timeout, socket down, denied storage -- the
 * in-memory list is empty for a reason that has nothing to do with what is
 * stored, and writing it deletes the lot. Nobody is told, because the write
 * itself succeeds.
 *
 * The guard lives HERE rather than in the service because there are seven
 * whole-list write sites across four modules (service.ts, outgoing-mutations.ts
 * x3, record-incoming.ts, and the two loaders' own callers). A guard in the
 * service would have covered three of them -- which is this repository's most
 * common defect shape, a correct fix applied in one of the places its mechanism
 * appears. One guard, on the path they all funnel through, cannot be bypassed
 * by adding an eighth.
 *
 * Absence counts as read: a key that genuinely holds nothing is a complete
 * picture of nothing, and the first write to it must be allowed to happen.
 */
const readIntoMemory: Set<string> = new Set<string>();

/** For tests: forget what has been read, so a fresh scenario starts cold. */
export function resetReadTracking(): void {
  readIntoMemory.clear();
}

/** Generic LocalDB set operation */
export async function localDBSet(
  key: string,
  data: unknown[],
  pendingKVRequests: Map<string, KVPendingEntry>,
  label: string
): Promise<void> {
  if (!readIntoMemory.has(key)) {
    // Refusing is the point. Writing a list assembled without a successful
    // read replaces whatever is stored with whatever this tab happens to
    // hold, which after a failed read is nothing at all.
    throw new Error(
      `Refusing to write ${label}: '${key}' was never successfully read, so ` +
        `writing the in-memory list would erase whatever is stored under it.`,
    );
  }

  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const { persistJSON } = await import('../storage-utils');
  const valueStr: string = persistJSON(data);

  const request: { LocalDBSetKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; value: number[]; }; } = {
    LocalDBSetKV: {
      request_id: requestId, cid: 0n, peer_cid: null,
      key, value: stringToBytes(valueStr)
    }
  };

  // Wrapped so the wait ends when the SOCKET does, not only when the timer
  // does. The internal service keys responses to the connection that asked, so
  // a request in flight at a drop can never be answered -- waiting the full
  // budget and then reporting "timed out" names the wrong cause.
  return failOnSocketLoss(`${label} persist`, new Promise<void>((resolve, reject) => {
    pendingKVRequests.set(requestId, { resolve: () => resolve(), reject });
    // `sendMessage`, not `getClient()`. A follower tab owns no client by
    // design, and the old branch RESOLVED SUCCESSFULLY on that path -- so an
    // incoming contact request that landed in a follower (they are CID-routed
    // to the tab owning the session, which is often not the leader) was never
    // written to LocalDB, and vanished on reload. Nothing failed; the request
    // simply ceased to exist.
    websocketService.sendMessage(request as unknown as Record<string, unknown>).catch(error => {
      debugLog('PeerRegistrationStore', `Failed to persist ${label}:`, error);
      pendingKVRequests.delete(requestId);
      reject(error);
    });
    setTimeout(() => {
      if (pendingKVRequests.has(requestId)) {
        pendingKVRequests.delete(requestId);
        debugLog('PeerRegistrationStore', `${label} persist timed out`);
        // REJECT. This resolved, so a persist that timed out reported success
        // -- and the caller went on believing the write had landed. Accept a
        // request, have the removal time out and "succeed", and on the next
        // reload the accepted request is pending again.
        //
        // The send-failure branch eight lines above already rejects. Same
        // function, same kind of failure, two answers.
        reject(new Error(`${label} persist timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }
    }, REQUEST_TIMEOUT_MS);
  }));
}

/**
 * What a read actually did, as distinct from whether it threw.
 *
 * `failed` is the case this file used to erase. Every failure branch --
 * a KV rejection, a send rejection, a timeout -- resolved `undefined`, which is
 * indistinguishable from "the key holds nothing". The caller then took an empty
 * in-memory list as the truth and the next incoming request wrote that list
 * over the key, deleting every request the read had failed to return.
 */
export type LoadOutcome = 'loaded' | 'absent' | 'failed';

/** Generic LocalDB get operation */
export async function localDBGet<T>(
  key: string,
  pendingKVRequests: Map<string, KVPendingEntry>,
  onLoaded: (data: T[]) => Promise<void>,
  label: string
): Promise<LoadOutcome> {
  const requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID();
  const request: { LocalDBGetKV: { request_id: `${string}-${string}-${string}-${string}-${string}`; cid: bigint; peer_cid: null; key: string; }; } = {
    LocalDBGetKV: {
      request_id: requestId, cid: 0n, peer_cid: null, key
    }
  };

  // Same reason as the write path: a load still pending when the socket drops
  // can never be answered. It resolves 'failed' rather than rejecting, because
  // a failed read is a state this module's callers must be able to inspect --
  // it is what withholds permission to write the whole list back.
  return failOnSocketLoss(`${label} load`, new Promise<LoadOutcome>((resolve) => {
    pendingKVRequests.set(requestId, {
      resolve: async (data: unknown) => {
        if (data && Array.isArray(data)) {
          await onLoaded(data as T[]);
          readIntoMemory.add(key);
          resolve('loaded');
          return;
        }
        // resolveKVResponse passes null for an empty value, which is a real
        // "this key holds nothing" rather than a failure.
        readIntoMemory.add(key);
        resolve('absent');
      },
      // An absent key and a broken read are not the same event, and this
      // reported both as nothing-stored. `isGenuinelyAbsent` is the one place
      // that distinction is spelled out; this file was on the test's exemption
      // list with the reason "its catches wrap sendMessage rejections on the
      // WRITE path" -- which was simply false. This is the read path.
      reject: (error: Error) => {
        if (isGenuinelyAbsent(error)) {
          debugLog('PeerRegistrationStore', `No ${label} stored yet`);
          readIntoMemory.add(key);
          resolve('absent');
          return;
        }
        debugLog('PeerRegistrationStore', `Failed to load ${label} from LocalDB`, error);
        resolve('failed');
      }
    });
    // See the persist path above: skipping this in a follower silently loaded
    // nothing, so a reload of the tab holding a pending request lost it.
    websocketService.sendMessage(request as unknown as Record<string, unknown>).catch(error => {
      debugLog('PeerRegistrationStore', `Failed to send ${label} load request:`, error);
      pendingKVRequests.delete(requestId);
      resolve('failed');
    });
    setTimeout(() => {
      if (pendingKVRequests.has(requestId)) {
        pendingKVRequests.delete(requestId);
        debugLog('PeerRegistrationStore', `${label} load timed out`);
        resolve('failed');
      }
    }, REQUEST_TIMEOUT_MS);
  })).catch((error: unknown) => {
    // A socket loss arrives as a rejection from failOnSocketLoss. For a READ
    // that is the same conclusion as any other failure: the list is unknown,
    // so nothing may be written over it.
    debugLog('PeerRegistrationStore', `${label} load ended with the socket`, error);
    return 'failed' as LoadOutcome;
  });
}
