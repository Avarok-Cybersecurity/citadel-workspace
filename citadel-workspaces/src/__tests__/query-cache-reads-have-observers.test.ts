/**
 * A query key that nothing observes does not survive five minutes.
 *
 * React Query garbage-collects a cache entry once it has no observers, after
 * the default five-minute gcTime. `setQueryData` alone does not create one —
 * only a `useQuery`/`useQueries` on that key does. So a value written with
 * `setQueryData` and read back with `getQueryData`, with no hook between them,
 * is a value that silently becomes `undefined` if the user is slow.
 *
 * The registration flow did exactly this with the user's chosen security
 * settings: raise your security level, spend five minutes on the profile step
 * with a password manager, and the account is created with the DEFAULTS —
 * permanently, with nothing said. Landing had already lifted the server address
 * out of the cache for this reason, and the fix was not carried across.
 *
 * The fallback is what hides it. `getQueryData(...) || defaults` reads as
 * "settings, or sensible defaults" and behaves as "settings, until the timer".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Keys read from the cache that genuinely need no observer, and why.
 *
 * A read whose only correct answer is "whatever is there right now, or
 * nothing" — a cache peek, not a data dependency — belongs here.
 */
const NO_OBSERVER_NEEDED: Record<string, string> = {};

const sources: (readonly [string, string])[] = await Promise.all(
  (
    await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    })
  ).map(async (rel) => [rel, stripComments(readFileSync(join(SRC, rel), 'utf-8'))] as const),
);

const all: string = sources.map(([, source]): string => source).join('\n');

describe('a value read back from the query cache', () => {
  it('has something observing its key, so it is not garbage-collected', () => {
    const offenders: string[] = [];

    for (const [rel, source] of sources) {
      for (const match of source.matchAll(/getQueryData<?[^>]*>?\(\s*\[\s*'([^']+)'/g)) {
        const key: string = match[1];
        if (key in NO_OBSERVER_NEEDED) continue;

        // An observer is a useQuery/useQueries naming the same key, anywhere.
        const observed: boolean = new RegExp(`useQuer(?:y|ies)[^;]{0,400}?\\[\\s*'${key}'`, 's').test(all);
        if (!observed) offenders.push(`${rel}: reads ['${key}'] which nothing observes`);
      }
    }

    expect(
      offenders,
      'nothing observes this key, so React Query drops the entry after its ' +
        'default five-minute gcTime and the read returns undefined. Hold the ' +
        'value in state and pass it down, or add a useQuery for the key.',
    ).toEqual([]);
  });

  it('keeps every exemption honest', () => {
    for (const key of Object.keys(NO_OBSERVER_NEEDED)) {
      expect(
        new RegExp(`getQueryData<?[^>]*>?\\(\\s*\\[\\s*'${key}'`).test(all),
        `['${key}'] is exempted but nothing reads it any more — drop the ` +
          `exemption rather than letting it shield a future one`,
      ).toBe(true);
    }
  });
});
