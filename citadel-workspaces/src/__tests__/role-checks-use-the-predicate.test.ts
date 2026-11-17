/**
 * A role compared against a literal is a copy of the predicate.
 *
 * There were seven of these and they already disagreed — three casing
 * conventions, two answers to "does Owner count", one copy that understood the
 * object role shape. An Owner saw the admin ring in TopBar and the shield in
 * the workspace switcher, then got null from AdminSettingsSection.
 *
 * Consolidating them fixes today. This stops the eighth: any new
 * `role === 'Admin'` re-forks the predicate, and whoever writes it will not
 * know about the object form or the lowercase paths.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** The predicate itself, and the tests that pin it. */
const CANONICAL: string[] = ['lib/role-predicate.ts'];

/**
 * Places that compare a role literal for a reason other than privilege.
 *
 * Empty, and the exemption test below keeps it that way: role-badge.ts looked
 * like the obvious entry, but it maps roles through a lookup object rather than
 * comparing them, so exempting it would have shielded a future comparison in a
 * file that never made one.
 */
const NOT_A_PRIVILEGE_CHECK: Record<string, string> = {};

/** `x === 'Admin'`, `x !== "owner"`, `role == `Owner`` — any comparison to a role literal. */
const ROLE_COMPARISON: RegExp = /[=!]==?\s*['"`](?:Admin|admin|Owner|owner)['"`]|['"`](?:Admin|admin|Owner|owner)['"`]\s*[=!]==?/;

describe('a role check', () => {
  it('goes through the predicate rather than comparing literals', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = files
      .filter((rel) => !CANONICAL.includes(rel) && !(rel in NOT_A_PRIVILEGE_CHECK))
      .filter((rel) => ROLE_COMPARISON.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))));

    expect(
      offenders,
      'this re-forks the role predicate. Use isPrivilegedRole / isAdminRole / ' +
        'isOwnerRole from lib/role-predicate, which handle the wire casing and ' +
        'the object role shape that a literal comparison silently misses.',
    ).toEqual([]);
  });

  it('keeps every exemption honest', () => {
    for (const rel of Object.keys(NOT_A_PRIVILEGE_CHECK)) {
      expect(
        ROLE_COMPARISON.test(stripComments(readFileSync(join(SRC, rel), 'utf-8'))),
        `${rel} is exempted but no longer compares a role literal — drop the ` +
          `exemption rather than letting it shield a future one`,
      ).toBe(true);
    }
  });
});
