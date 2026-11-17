/**
 * A button with no handler is a promise the app does not keep.
 *
 * This has now been the finding twice in the same component: round 131 found
 * both Invite buttons in the user directory rendered with no `onClick`, and the
 * fix was applied to those two and not to "Remove Connection" in the connected
 * branch of the same card — a destructive-looking control that did nothing,
 * which teaches the user that disconnecting is broken.
 *
 * A control that operates on nothing is worse than a missing one: the user
 * clicks, nothing happens, and they cannot tell that from a failure.
 *
 * The scan is textual and therefore conservative — it asks only whether a
 * `<Button>` opening tag carries something that could make it act. Anything
 * that does is accepted, because the alternative is a rule people route around.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { stripComments } from '@/test-utils/strip-comments';

const SRC: string = join(process.cwd(), 'src');

/** Anything that gives a button an effect, or hands its behaviour elsewhere. */
const ACTS: RegExp =
  /\bonClick|\bonPointerDown|\bonMouseDown|\btype=["'{]?submit|\basChild\b|\bdisabled\b|\bhref=|\{\.\.\./;

describe('a rendered Button', () => {
  it('has something to do when clicked', async () => {
    const files: string[] = await fg(['**/*.tsx'], {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.tsx', 'test-utils/**', 'components/ui/**'],
    });

    const offenders: string[] = [];

    for (const rel of files) {
      const source: string = stripComments(readFileSync(join(SRC, rel), 'utf-8'));

      // Each `<Button ...>` opening tag, up to the `>` that closes it.
      for (const match of source.matchAll(/<Button\b([^>]*)>/g)) {
        const attributes: string = match[1];
        if (ACTS.test(attributes)) continue;

        // A trigger that renders its child IS the handler: `<DropdownMenuTrigger
        // asChild><Button>` gets its behaviour from the trigger, and requiring
        // an onClick there would push people to add a no-op one.
        const before: string = source.slice(Math.max(0, match.index - 120), match.index);
        // `{}` is what stripComments leaves behind for a JSX comment, and
        // several of these triggers carry one explaining the accessible name.
        if (/asChild\s*>\s*(\{\s*\}\s*)?$/.test(before)) continue;

        const line: number = source.slice(0, match.index).split('\n').length;
        offenders.push(`${rel}:${line}`);
      }
    }

    expect(
      offenders,
      'this Button has no onClick, no submit type, no asChild and no spread — ' +
        'so it renders as a control and does nothing. Wire it, or remove it ' +
        'and stop offering a capability that does not exist.',
    ).toEqual([]);
  });
});
