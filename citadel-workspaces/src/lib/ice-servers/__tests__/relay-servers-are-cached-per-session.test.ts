/**
 * A session's relay servers are asked for once, reused until 80% of their
 * lifetime, and a refusal is believed for a minute.
 *
 * Only the transport is faked: `IceServersPort` answers with the response the
 * workspace server would send. Parsing, caching and the clock arithmetic are
 * the production code.
 */
import { describe, it, expect } from 'vitest';
import { IceServersCache, REFUSAL_CACHE_MS, type IceServersPort } from '../cache';
import { parseIceServersAnswer } from '../parse';
import { lazyTurnSource } from '../lazy-turn-source';
import type { TurnSource } from '../peer-connect-turn';
import type { IceServersAnswer, IceServersGrant, TurnConfig } from '@/types/ice-servers';

const ALICE: bigint = 1001n;
const BOB: bigint = 2002n;
/** t=0 of the fake clock, in ms; the grant below expires 1000s later. */
const T0_MS: number = 1_700_000_000_000;
const EXPIRES_AT_S: number = T0_MS / 1000 + 1000;

/** The answer as it reaches the UI: JSON-decoded, so `expires_at` is a number. */
function granted(credential: string): Record<string, unknown> {
  return {
    IceServers: {
      ice_servers: [{ urls: ['turns:turn.example:443?transport=tcp'], username: 'u', credential }],
      expires_at: EXPIRES_AT_S,
    },
  };
}

interface Harness {
  cache: IceServersCache;
  asked: bigint[];
  setNow: (ms: number) => void;
}

function harness(answer: (cid: bigint) => unknown): Harness {
  let now: number = T0_MS;
  const asked: bigint[] = [];
  const port: IceServersPort = {
    request: async (cid: bigint): Promise<unknown> => {
      asked.push(cid);
      const value: unknown = answer(cid);
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { cache: new IceServersCache(port, (): number => now), asked, setNow: (ms: number): void => { now = ms; } };
}

describe('parsing the GetIceServers answer', () => {
  it('reads a sample IceServers response into a bigint-dated grant', () => {
    const answer: IceServersAnswer | null = parseIceServersAnswer(granted('pw'));
    expect(answer).toEqual({
      kind: 'granted',
      grant: {
        ice_servers: [{ urls: ['turns:turn.example:443?transport=tcp'], username: 'u', credential: 'pw' }],
        expires_at: BigInt(EXPIRES_AT_S),
      },
    });
  });

  it('reads Unavailable and Error, and nothing else', () => {
    expect(parseIceServersAnswer({ IceServersUnavailable: { reason: 'no relay' } }))
      .toEqual({ kind: 'unavailable', reason: 'no relay' });
    expect(parseIceServersAnswer({ Error: 'Guests may not relay' }))
      .toEqual({ kind: 'refused', message: 'Guests may not relay' });
    expect(parseIceServersAnswer({ Workspace: { id: 'w' } })).toBeNull();
    expect(parseIceServersAnswer({ IceServers: { ice_servers: [{ urls: 'not-a-list' }], expires_at: 1 } })).toBeNull();
  });
});

describe('the relay cache', () => {
  it('answers from memory before 80% of the lifetime, and asks again after', async () => {
    const h: Harness = harness((): unknown => granted('pw'));

    const first: IceServersGrant | null = await h.cache.get(ALICE);
    expect(first?.ice_servers[0]?.credential).toBe('pw');

    h.setNow(T0_MS + 799_000); // 79.9% of 1000s
    await h.cache.get(ALICE);
    expect(h.asked).toEqual([ALICE]);

    h.setNow(T0_MS + 801_000); // past 80%
    await h.cache.get(ALICE);
    expect(h.asked).toEqual([ALICE, ALICE]);
  });

  it('keeps each session’s grant apart', async () => {
    const h: Harness = harness((): unknown => granted('pw'));
    await h.cache.get(ALICE);
    await h.cache.get(BOB);
    expect(h.asked).toEqual([ALICE, BOB]);
  });

  it('shares one request between concurrent callers', async () => {
    const h: Harness = harness((): unknown => granted('pw'));
    await Promise.all([h.cache.get(ALICE), h.cache.get(ALICE)]);
    expect(h.asked).toEqual([ALICE]);
  });

  it.each([
    ['Unavailable', { IceServersUnavailable: { reason: 'not configured' } }],
    ['Error', { Error: 'Permission denied' }],
    ['a failed request', new Error('no answer within 5000ms')],
  ])('answers null for %s and believes it for a minute', async (_label: string, answer: unknown) => {
    const h: Harness = harness((): unknown => answer);

    expect(await h.cache.get(ALICE)).toBeNull();
    h.setNow(T0_MS + REFUSAL_CACHE_MS - 1);
    expect(await h.cache.get(ALICE)).toBeNull();
    expect(h.asked).toEqual([ALICE]);

    h.setNow(T0_MS + REFUSAL_CACHE_MS);
    await h.cache.get(ALICE);
    expect(h.asked).toEqual([ALICE, ALICE]);
  });
});

describe('the lazily-loaded relay source', () => {
  it('loads once, and a failed load connects without a relay and is retried', async () => {
    const turn: TurnConfig = { policy: 'fallback', ice_servers: [], expires_at: 1n };
    let loads: number = 0;
    const source: TurnSource = lazyTurnSource(async (): Promise<TurnSource> => {
      loads += 1;
      if (loads === 1) throw new Error('chunk failed to load');
      return async (): Promise<TurnConfig> => turn;
    });

    expect(await source(ALICE)).toBeNull();
    expect(await source(ALICE)).toBe(turn);
    expect(await source(BOB)).toBe(turn);
    expect(loads).toBe(2);
  });
});
