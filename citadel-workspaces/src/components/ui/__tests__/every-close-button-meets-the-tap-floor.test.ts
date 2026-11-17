/**
 * Every overlay's close button must state the 24px floor.
 *
 * `h-6 w-6` looks like 24px and is not: Tailwind's 6 is 1.5rem and this app's
 * root font is 14px, so it renders 21x21. `.tap-target` states the floor in the
 * unit the standard is written in.
 *
 * The dialog's close button was fixed, with a long comment explaining exactly
 * that. Its identical twin in `sheet.tsx`, one file over, was not — and the
 * notification centre is a Sheet, so a CI viewport probe measured that button
 * at 21x21 and failed the 375px layout check months later.
 *
 * A fix applied in one place is not a fix, and nothing here was watching the
 * mechanism. This does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UI: string = join(process.cwd(), 'src', 'components', 'ui');

describe('an overlay close button', () => {
  it('carries the tap-target floor wherever one is rendered', () => {
    const offenders: string[] = [];

    for (const entry of readdirSync(UI)) {
      if (!entry.endsWith('.tsx')) continue;
      const source: string = readFileSync(join(UI, entry), 'utf-8');

      // Radix spells every one of these `<XPrimitive.Close ...>`. Matching the
      // primitive rather than the word "Close" means a renamed label cannot
      // hide one from this check.
      for (const match of source.matchAll(/<\w+Primitive\.Close\b([^>]*)>/g)) {
        const attributes: string = match[1];
        if (!attributes.includes('className')) continue;
        if (!attributes.includes('tap-target')) {
          offenders.push(`${entry}: a Close primitive without tap-target`);
        }
      }
    }

    expect(
      offenders,
      'h-6 w-6 renders 21x21 at this app’s 14px root font. tap-target is what ' +
        'states the 24px floor, and every close button needs it, not just the one ' +
        'somebody happened to measure.',
    ).toEqual([]);
  });
});
