/**
 * Nothing reads "the first saved account" as "this tab's account".
 *
 * Several accounts share one browser. The workspace-initialise dialog took its
 * server from `getStoredSessionsArray()[0]`, so after /create it named another
 * account's server (live: test-sep25 showed admin-lab) and the claim-code
 * prefill, which matches on that server, never fired. The permissions handler
 * used the same entry to adopt a role. This tab's identity is tab-identity.ts
 * and its workspace address is use-workspace-address.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(__dirname, '..');
const FIRST_SAVED: RegExp = /getStoredSessionsArray\(\)\s*\[\s*0\s*\]/;

describe('the first saved account', () => {
  it('is never taken for this tab', () => {
    const offenders: string[] = fg.sync('**/*.{ts,tsx}', { cwd: SRC, ignore: ['**/__tests__/**', '**/*.test.*'] })
      .filter((file: string): boolean => FIRST_SAVED.test(stripComments(readFileSync(join(SRC, file), 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
