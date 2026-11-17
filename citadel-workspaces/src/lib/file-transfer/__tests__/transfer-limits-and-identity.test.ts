/**
 * Three severed joints in one feature.
 *
 * The chat file-transfer paths were each meticulously repaired around a break
 * that was one hop further along:
 *
 *  - Accept/decline sent `cid: 0` with the comment "Not used for message-based".
 *    The internal service looks the connection up by exactly that field, and
 *    nothing is filed under 0, so every response came back "Connection not
 *    found" -- on a fire-and-forget send that checked nothing, with `cid: 0` on
 *    the failure so CID routing could not deliver it to a tab either. No chat
 *    transfer ever moved a byte.
 *  - The default "Recommended" async mode sent `cid: null` for a non-nullable
 *    u64, so the request failed deserialization in the WASM client and never
 *    left the browser.
 *  - The max-file-size setting was written under `"{ownCid}:{peerCid}"` and read
 *    under the bare peer CID, so both the send-time and accept-time checks
 *    always saw the 100 MiB default and the slider limited nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cidRef: { current: bigint | null; } = { current: null as bigint | null };
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: { get cid(): bigint | null { return cidRef.current; } },
}));

import { scopedSettingsKey } from '../settings-key';

describe('file-transfer settings scoping', () => {
  beforeEach(() => { cidRef.current = null; });

  it('scopes a peer\'s settings to the account that set them', () => {
    cidRef.current = 111n;
    const a: string = scopedSettingsKey('999');
    cidRef.current = 222n;
    const b: string = scopedSettingsKey('999');

    expect(a, 'two accounts shared one peer\'s transfer settings').not.toBe(b);
  });

  it('gives the same key for the same account and peer', () => {
    cidRef.current = 111n;
    expect(scopedSettingsKey('999')).toBe(scopedSettingsKey('999'));
  });

  it('falls back to the bare peer key when no session exists', () => {
    // Settings written before a session belong to no account, and filing them
    // under a guessed one would be worse than leaving them unscoped.
    expect(scopedSettingsKey('999')).toBe('999');
  });

  it('builds the key the writer uses', () => {
    cidRef.current = 111n;
    expect(scopedSettingsKey('999')).toBe('111:999');
  });
});

describe('every settings read', () => {
  it('goes through the scoped key', async () => {
    // The whole defect: the writer scoped and the reader did not. A test that
    // mocks getSettings wholesale -- as the existing accept-size test does --
    // cannot see a key mismatch, so this scans for the call shape instead.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fg: typeof import('fast-glob') = (await import('fast-glob')).default;
    const { stripComments } = await import('@/test-utils/strip-comments');

    const dir: string = join(process.cwd(), 'src/lib/file-transfer');
    // `state.ts` defines getSettings and `service.ts` owns the scoping itself;
    // everything else is a consumer, and a consumer reading unscoped is the
    // defect.
    const files: string[] = await fg(['**/*.ts'], {
      cwd: dir,
      ignore: ['__tests__/**', 'state.ts', 'service.ts'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(dir, rel), 'utf-8'));
      for (const match of source.matchAll(/getSettings\(([^)]*)\)/g)) {
        const arg: string = match[1].trim();
        if (arg === '' || arg.startsWith('scopedSettingsKey') || arg.startsWith('this.scopedKey')) {
          continue;
        }
        offenders.push(`${rel}: getSettings(${arg})`);
      }
    }

    expect(
      offenders,
      'a settings read that does not scope by account reads a key nothing writes, ' +
        'so it always returns the defaults while looking correct',
    ).toEqual([]);
  });
});
