/**
 * A square icon button must carry the 24px floor.
 *
 * `check-mobile-layout.mjs` measures tap targets, and once it could run again
 * (round 188) it found three controls at 21x21 against WCAG 2.2's 24px floor —
 * with a comment beside one of them asserting it was 24px. It is not: `h-6` is
 * `1.5rem`, the app's root font size is 14px, and every rem-based size in the
 * product renders at 87.5% of nominal.
 *
 * That check only reaches four screens, all of them pre-auth, because the rest
 * of the app needs an account. Ten more `h-6 w-6` buttons sat behind the login
 * — message actions, notification dismiss, tree node menus, member removal —
 * all 21x21, all unreachable by any browser check this repository can run
 * without a backend.
 *
 * So the rule is asserted against the source instead of the screen, which is
 * the move that keeps working here: the tokens, the schema, the class names.
 * A browser check sees one rendering; the source is every rendering.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC: string = resolve(__dirname, '..');

/** The square box an icon button gets: `h-6 w-6` and its smaller siblings. */
const SQUARE_BOX: RegExp = /\bh-(4|5|6) w-\1\b/;

/**
 * A FRESH regex each time, never a shared constant.
 *
 * This was `const BUTTON_TAG = /…/gs` at module scope, and the first test
 * called `.test()` on it. A global regex advances `lastIndex` on `test()`, and
 * `matchAll` starts from that index — so the second test began scanning each
 * file partway through and skipped every button before the offset. Removing
 * `tap-target` from a real button did not fail it.
 *
 * Caught by running the negative control, which is the only reason it is not
 * still passing over nothing.
 */
const buttonTags = (): RegExp => /<(?:button|Button)\b[^>]*?>/gs;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...tsxFiles(path));
    } else if (entry.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

describe('every square icon button', () => {
  const files: string[] = tsxFiles(SRC);

  it('reads a real corpus, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(50);
    const anyButton: boolean = files.some((f): boolean => buttonTags().test(readFileSync(f, 'utf-8')));
    expect(anyButton).toBe(true);
  });

  it('carries the tap-target floor', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source: string = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(buttonTags())) {
        const tag: string = match[0];
        if (!SQUARE_BOX.test(tag)) continue;
        if (tag.includes('tap-target')) continue;
        const line: number = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    // Named with their line, because the fix is one class and the reader needs
    // to see how many places would otherwise ship a 21px control.
    expect(offenders).toEqual([]);
  });
});
