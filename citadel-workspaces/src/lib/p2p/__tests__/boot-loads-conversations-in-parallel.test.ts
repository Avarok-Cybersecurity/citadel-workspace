/**
 * Boot must not pay one round trip per conversation, in series.
 *
 * Every `loadMetadataByKey` is a request to the agent, and on a follower tab a BroadcastChannel
 * hop to the leader and back on top of that. Awaiting them one at a time put N latencies on the
 * path to a usable workspace — the same path a new member watches as "Loading workspace...".
 *
 * These tests pin the two properties that matter and would otherwise drift apart: the reads
 * overlap, and the result is still exactly what the serial version produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const keys: string[] = Array.from({ length: 20 }, (_, i) => `p2p_conv_${i}_metadata`);
let inFlight: number = 0;
let peakInFlight: number = 0;
const started: string[] = [];

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBListKeys: async (): Promise<string[]> => keys,
  },
}));
vi.mock('../message-page-operations', () => ({
  loadMetadataByKey: async (key: string): Promise<{ peerCid: bigint; messageCount: number; }> => {
    started.push(key);
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight -= 1;
    // bigint, because that is what `ConversationMetadata.peerCid` is.
    // Returning a string here made the fixture disagree with the type it
    // stands in for, and the assertion below then had to cast the result to
    // `{ peerCid: string }` to compile -- a cast that made the test agree with
    // the fixture rather than with production.
    return { peerCid: BigInt(key.replace(/\D/g, '')), messageCount: 1 };
  },
}));
vi.mock('@/lib/multi-instance', () => ({ instanceManager: { cid: null } }));
vi.mock('@/lib/debug-config', () => ({ debugEnabled: false, debugLog: (): void => {} }));

import { loadAllMetadata } from '../load-all-metadata';
import type { ConversationMetadata } from '@/lib/p2p/p2p-types';

describe('boot loads conversations in parallel', () => {
  beforeEach(() => {
    inFlight = 0;
    peakInFlight = 0;
    started.length = 0;
  });

  it('overlaps the reads instead of awaiting them one at a time', async () => {
    await loadAllMetadata();
    expect(peakInFlight, 'the reads ran strictly one after another').toBeGreaterThan(1);
  });

  it('keeps the queue bounded rather than firing every key at once', async () => {
    await loadAllMetadata();
    expect(peakInFlight, 'an unbounded burst moves the queue to the agent rather than removing it')
      .toBeLessThanOrEqual(8);
  });

  it('returns every conversation, in key order', async () => {
    const result: ConversationMetadata[] = await loadAllMetadata();
    expect(result).toHaveLength(keys.length);
    // Compared as bigint. `peerCid` IS a bigint -- CLAUDE.md's CID rule is
    // that string is for display, keys and logging only -- so casting it to
    // `{ peerCid: string }` was a lie tsc rightly refused.
    expect(result.map((m) => m.peerCid)).toEqual(
      keys.map((k) => BigInt(k.replace(/\D/g, ''))),
    );
  });

  it('finishes in well under the serial time', async () => {
    const started_at: number = Date.now();
    await loadAllMetadata();
    const elapsed: number = Date.now() - started_at;
    // 20 reads × 10ms serial = 200ms; eight at a time should be nearer 30ms.
    expect(elapsed, `took ${elapsed}ms, which is the serial cost`).toBeLessThan(150);
  });
});
