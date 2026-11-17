/**
 * Every appearance preference must have something that reads it.
 *
 * The tab shipped with three preferences nothing consumed and two root classes
 * no stylesheet defined. Nothing failed, nothing warned; the switches simply
 * moved. This scan is what stops the next one being added the same way.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Preferences whose reader is somewhere ELSE in the tree, and the token that
 * proves the reader exists. These are the ones that can silently go dead.
 */
const CONSUMED_BY: Record<string, string> = {
  sidebarWidth: '--appearance-sidebar-width',
  showAvatars: 'data-avatars',
  // Off is `.reduce-motion`, as the switch was; Lite is the class only a tiered choice can set.
  animations: '.lite-motion',
};

/**
 * Preferences the browser itself consumes, with no reader in this codebase to
 * point at. The unit tests assert the document state directly instead; there is
 * nothing here for a scan to find.
 */
const BROWSER_APPLIED: Record<string, string> = {
  fontSize: 'root font-size is read by the layout engine, not by our code',
};

describe('appearance preferences', () => {
  it('each one is read somewhere outside the module that writes it', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx', '**/*.css'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'lib/appearance-settings.ts'],
    });
    const tree: string = files
      .map((rel) => stripComments(readFileSync(join(SRC, rel), 'utf-8')))
      .join('\n');

    const unread: string[] = Object.entries(CONSUMED_BY)
      .filter(([, token]) => !tree.includes(token))
      .map(([pref, token]) => `${pref} (nothing reads ${token})`);

    expect(
      unread,
      'a preference nothing reads is a switch that moves and changes nothing',
    ).toEqual([]);
  });

  it('lists every preference the settings type declares', async () => {
    const module: string = readFileSync(join(SRC, 'lib/appearance-settings.ts'), 'utf-8');
    const body: string = module.slice(
      module.indexOf('export interface AppearanceSettings'),
      module.indexOf('export const APPEARANCE_STORAGE_KEY'),
    );
    const declared: string[] = [...body.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m): string => m[1]);

    // Adding a field to the interface without adding it here leaves the scan
    // above passing over a preference it never checked.
    const covered: string[] = [...Object.keys(CONSUMED_BY), ...Object.keys(BROWSER_APPLIED)];
    expect(declared.sort()).toEqual(covered.sort());
  });
});
