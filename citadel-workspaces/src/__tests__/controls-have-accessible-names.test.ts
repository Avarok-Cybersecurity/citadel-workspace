/**
 * A control whose name sits beside it has no name.
 *
 * Radix's Switch, Slider, Checkbox and SelectTrigger all render an element with
 * no inner text. A `<Label>` next to one is visual only: the accessibility tree
 * pairs them through `htmlFor`/`id`, and without that a screen reader announces
 * "switch, on" — the setting's name never reaches it.
 *
 * `GeneralSettingsTab` documents this at length beside its one correct call
 * site ("htmlFor/id, not proximity"). It was applied there and nowhere else, so
 * every toggle in Privacy, Appearance and the three chat-settings tabs was
 * unnamed — including the read-receipt and online-status switches, which is
 * someone changing their privacy blind. This is the repo's most productive
 * defect shape, in the one place where the correct pattern was already written
 * down.
 *
 * The scan is textual and conservative: any way of naming a control counts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** Controls that render with no inner text of their own. */
const NAMELESS_BY_DEFAULT: RegExp = /<(Switch|Slider|Checkbox|SelectTrigger)\b/g;

/**
 * The attributes of the tag opening at `start`, to its real closing `>`.
 *
 * `[^>]*` stops at the first `>`, and `onCheckedChange={() => ...}` contains
 * one — so a control named AFTER its handler read as unnamed. Brace depth is
 * what separates a JSX expression's `>` from the tag's.
 */
function attributesOf(source: string, start: number): string {
  let depth: number = 0;
  for (let i: number = start; i < source.length; i++) {
    const c: string = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(start, i);
  }
  return source.slice(start);
}

/** Any way a name reaches the accessibility tree. */
const NAMED: RegExp = /\bid=|\baria-label(?:ledby)?=|\{\.\.\./;

describe('a control with no text of its own', () => {
  it('is named, not merely sat next to a Label', async () => {
    const files: string[] = await fg(['**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.tsx', 'test-utils/**', 'components/ui/**'],
    });

    const offenders: string[] = [];

    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));

      for (const match of source.matchAll(NAMELESS_BY_DEFAULT)) {
        if (NAMED.test(attributesOf(source, match.index + match[0].length))) continue;
        const line: number = source.slice(0, match.index).split('\n').length;
        offenders.push(`${rel}:${line} <${match[1]}>`);
      }
    }

    expect(
      offenders,
      'this renders as a control with no accessible name. Pair it with its ' +
        'Label through htmlFor/id, or give it an aria-label — a Label merely ' +
        'beside it is visual only.',
    ).toEqual([]);
  });

  it('pairs every settings Label with a control', async () => {
    // The other direction: an htmlFor pointing at nothing is as broken as no
    // htmlFor, and it looks more correct.
    const files: string[] = await fg(['components/settings/**/*.tsx', 'components/p2p/ChatSettings*.tsx'], {
      cwd: SRC,
    });

    const dangling: string[] = [];

    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));

      for (const match of source.matchAll(/htmlFor="([^"]+)"/g)) {
        if (!source.includes(`id="${match[1]}"`)) dangling.push(`${rel}: htmlFor="${match[1]}"`);
      }
    }

    expect(dangling, 'this htmlFor names an id that does not exist in the file').toEqual([]);
  });
});
