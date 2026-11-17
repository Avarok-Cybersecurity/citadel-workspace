/**
 * A read that failed must not authorise writing the whole list back.
 *
 * Every persist in this module writes the WHOLE list for a key. That is sound
 * only when the in-memory list is a faithful copy of what is stored — which is
 * true only if the key was actually read. This file's read path used to erase
 * that distinction: a KV rejection, a send rejection and a timeout all resolved
 * `undefined`, indistinguishable from "the key holds nothing".
 *
 * So: two pending contact requests on disk, reload, the read times out, the
 * list is empty, a third request arrives, and the third is written over the
 * key. The first two are gone and nobody is told, because the write succeeded.
 *
 * The guard lives in `persistence.ts` rather than in the service because there
 * are seven whole-list write sites across four modules. A guard in the service
 * would have covered three — the "fixed in one of the places its mechanism
 * appears" shape this repository keeps finding.
 *
 * These tests drive the real `localDBGet`/`localDBSet` through a faked
 * `websocketService`, so the production classification runs. Nothing in the
 * module under test is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sent: Record<string, unknown>[] = [];
let sendBehaviour: 'ok' | 'reject' = 'ok';

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendMessage: (message: Record<string, unknown>): Promise<void> => {
      sent.push(message);
      return sendBehaviour === 'reject'
        ? Promise.reject(new Error('socket is down'))
        : Promise.resolve();
    },
  },
}));

import {
  persistPendingToLocalDB,
  loadPendingFromLocalDB,
  resetReadTracking,
  rejectKVFailure,
  resolveKVResponse,
  resolveKVSetSuccess,
  type LoadOutcome,
} from '../persistence';
import type { KVPendingEntry } from '../types';

/** The request id of the last LocalDBGetKV that went out. */
function lastGetRequestId(): string {
  const get: Record<string, unknown> | undefined = [...sent].reverse().find((m: Record<string, unknown>): boolean => 'LocalDBGetKV' in m);
  if (!get) throw new Error('no LocalDBGetKV was sent');
  return (get.LocalDBGetKV as { request_id: string }).request_id;
}

function setsSent(): Record<string, unknown>[] {
  return sent.filter((m) => 'LocalDBSetKV' in m);
}

/**
 * Run a persist to completion, answering the LocalDBSetKV it emits.
 *
 * The write really does wait for its response now — that is the other half of
 * this change, since a timed-out persist used to resolve as though it had
 * landed. So a test that lets one through has to answer it.
 */
async function persistAnswering(
  requests: never[],
  kv: Map<string, KVPendingEntry>,
): Promise<void> {
  const done: Promise<void> = persistPendingToLocalDB(requests, kv);
  // localDBSet does a dynamic `import()` before sending, so the request is
  // several microtask turns away rather than one. Poll rather than guess.
  let set: Record<string, unknown> | undefined;
  for (let i: number = 0; i < 50 && !set; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    set = [...sent].reverse().find((m) => 'LocalDBSetKV' in m);
  }
  if (!set) throw new Error('no LocalDBSetKV was sent');
  resolveKVSetSuccess(kv, (set.LocalDBSetKV as { request_id: string }).request_id);
  await done;
}

describe('a whole-list write', () => {
  let kv: Map<string, KVPendingEntry>;

  beforeEach(() => {
    sent.length = 0;
    sendBehaviour = 'ok';
    resetReadTracking();
    kv = new Map<string, KVPendingEntry>();
  });

  it('is refused when the key was never read at all', async () => {
    // No load has run. Writing here would replace the stored list with
    // whatever this tab happens to hold, which is nothing.
    await expect(persistPendingToLocalDB([], kv)).rejects.toThrow(/never successfully read/);
    expect(setsSent(), 'nothing may reach the socket').toHaveLength(0);
  });

  it('is refused when the read failed rather than found nothing', async () => {
    const load: Promise<LoadOutcome> = loadPendingFromLocalDB(kv, async () => {});
    rejectKVFailure(kv, lastGetRequestId(), 'LocalDB request timed out');
    expect(await load).toBe('failed');

    await expect(persistPendingToLocalDB([], kv)).rejects.toThrow(/never successfully read/);
    expect(setsSent()).toHaveLength(0);
  });

  it('is refused when the request could not even be sent', async () => {
    sendBehaviour = 'reject';
    expect(await loadPendingFromLocalDB(kv, async () => {})).toBe('failed');
    await expect(persistPendingToLocalDB([], kv)).rejects.toThrow(/never successfully read/);
  });

  it('is ALLOWED when the key genuinely holds nothing', async () => {
    // The discrimination that matters. A first-run user has no stored list,
    // and their first write must land. A guard that blocked this too would be
    // safe and useless.
    const load: Promise<LoadOutcome> = loadPendingFromLocalDB(kv, async () => {});
    rejectKVFailure(kv, lastGetRequestId(), 'Key not found');
    expect(await load).toBe('absent');

    await expect(persistAnswering([], kv)).resolves.toBeUndefined();
    expect(setsSent(), 'the write must reach the socket').toHaveLength(1);
  });

  it('is ALLOWED after a read that returned data', async () => {
    const seen: unknown[][] = [];
    const load: Promise<LoadOutcome> = loadPendingFromLocalDB(kv, async (requests) => {
      seen.push(requests);
    });
    resolveKVResponse(kv, lastGetRequestId(), Array.from(new TextEncoder().encode('[]')));
    expect(await load).toBe('loaded');

    await expect(persistAnswering([], kv)).resolves.toBeUndefined();
    expect(setsSent()).toHaveLength(1);
  });
});
