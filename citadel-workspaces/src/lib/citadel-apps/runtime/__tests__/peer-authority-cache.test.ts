/**
 * What the P2P authority holds (S9): an answer asked before an eviction is never held after it,
 * and a refusal is held for REFUSAL_CACHE_MS so a flood of refused heads costs one kernel ask.
 * The kernel is an injected ask whose answers the test releases; the cache is the production one.
 */
import { describe, expect, it } from 'vitest';
import type { PeerAuthorization } from '../../member-consent-types';
import { PeerAuthority, REFUSAL_CACHE_MS } from '../peer-authority';

const ALLOWED: PeerAuthorization = { ok: true, peer: { username: 'a', cid: 1n, app_id: 'net.avarok.x', install_id: 'i' }, untilMs: 60_000n };
const REFUSED: PeerAuthorization = { ok: false, why: 'NoHost' };

interface HeldKernel { asks: number; release: () => void; ask: () => Promise<PeerAuthorization> }

/** A kernel whose every answer waits until the test releases it. */
function kernel(answer: PeerAuthorization): HeldKernel {
  const waiting: (() => void)[] = [];
  const k: HeldKernel = {
    asks: 0,
    release: (): void => { for (const go of waiting.splice(0)) go(); },
    ask: (): Promise<PeerAuthorization> => {
      k.asks += 1;
      return new Promise<PeerAuthorization>((resolve) => { waiting.push(() => resolve(answer)); });
    },
  };
  return k;
}

describe('the held answer and an eviction', () => {
  it('an answer in flight when every answer was evicted is not held (control: without the eviction it is)', async () => {
    for (const evict of [true, false]) {
      const k: HeldKernel = kernel(ALLOWED);
      const a: PeerAuthority = new PeerAuthority(k.ask, () => 0, 30);
      const first: Promise<unknown> = a.authorize(1n, 'Call');
      if (evict) a.evictAll();
      k.release();
      await first;
      const second: Promise<unknown> = a.authorize(1n, 'Call');
      k.release();
      await second;
      expect([evict, k.asks]).toEqual([evict, evict ? 2 : 1]);
    }
  });
});

describe('a refusal', () => {
  it('is held for REFUSAL_CACHE_MS, then asked again', async () => {
    const now: { ms: number } = { ms: 0 };
    const k: HeldKernel = kernel(REFUSED);
    const a: PeerAuthority = new PeerAuthority(k.ask, () => now.ms, 30);
    const first: Promise<unknown> = a.authorize(1n, 'Call');
    k.release();
    expect(await first).toEqual(REFUSED);
    now.ms = REFUSAL_CACHE_MS - 1;
    expect(await a.authorize(1n, 'Call')).toEqual(REFUSED);
    expect(k.asks).toBe(1);
    now.ms = REFUSAL_CACHE_MS;
    const again: Promise<unknown> = a.authorize(1n, 'Call');
    k.release();
    await again;
    expect(k.asks).toBe(2);
  });
});
