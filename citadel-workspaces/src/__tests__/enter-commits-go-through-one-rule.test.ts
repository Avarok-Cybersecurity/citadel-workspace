/**
 * Every place that handles Enter itself has to suppress it during IME
 * composition — and this is exactly the kind of rule that gets written once and
 * never propagated.
 *
 * It was: the chat composer carried the `isComposing` check and said so in a
 * comment, while the rename input, the path bar, the document-title modal and
 * the hex field each handled Enter themselves and each went without. A user
 * typing Japanese, Chinese or Korean committed a half-composed value every time
 * they chose a character.
 *
 * This scan is the thing that keeps the fix propagated. A new `key === 'Enter'`
 * either routes through the shared rule or names itself here with a reason.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/**
 * Files allowed to compare against Enter directly, and why. Activation on a
 * non-text element cannot have a composition in progress — there is no text
 * being composed to confirm.
 */
const EXEMPT: Record<string, string> = {
  'components/layout/sidebar/FocusedTree/useTreeKeyboard.ts':
    'Enter/Space activates a tree row; the row is not a text field',
  'components/file-manager/useItemActivation.ts':
    'Enter opens a list row or grid tile; neither is a text field',
  'lib/keyboard-commit.ts': 'the shared rule itself',
};

describe('Enter handling', () => {
  it('routes every self-handled Enter through the shared composition rule', async () => {
    const files: string[] = await fg(['**/*.ts', '**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'test-utils/**'],
    });

    const offenders: string[] = [];
    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      if (!/key\s*===\s*['"]Enter['"]/.test(source)) continue;
      if (rel in EXEMPT) continue;
      if (source.includes('isEnterCommit')) continue;
      offenders.push(rel);
    }

    expect(
      offenders,
      `these compare against Enter directly, so an IME confirmation commits a ` +
        `half-composed value. Use isEnterCommit from @/lib/keyboard-commit, or ` +
        `add the file to EXEMPT with the reason it cannot be composing.`,
    ).toEqual([]);
  });

  it('keeps every exempt entry real', async () => {
    for (const rel of Object.keys(EXEMPT)) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));
      expect(
        /key\s*===\s*['"]Enter['"]/.test(source),
        `${rel} is exempted but no longer handles Enter — drop the exemption ` +
          `rather than letting it shield a future one`,
      ).toBe(true);
    }
  });
});
