/**
 * A dialog's background is the dialog component's, never the caller's.
 *
 * "Plan & billing" reached production as a dark-blue panel: its `DialogContent` carried
 * `bg-surface`, the elevated token menus and hover rows use (#262C4A in dark mode), which
 * painted over the `bg-background` every current dialog has. Three more dialogs carried the
 * same override, behind screens no browser check reaches without an account, so the rule is
 * asserted against the source: one rendering is a screen, the source is every rendering.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC: string = resolve(__dirname, '..');

/** A fresh regex per use: a shared global one keeps `lastIndex` between files. */
const dialogContentTags = (): RegExp => /<(?:DialogContent|AlertDialogContent)\b[^>]*?>/gs;
const SURFACE_OVERRIDE: RegExp = /\bbg-surface\b/;

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

describe('every dialog', () => {
  const tags: { file: string; tag: string }[] = tsxFiles(SRC).flatMap((file: string) =>
    [...readFileSync(file, 'utf8').matchAll(dialogContentTags())].map((m: RegExpMatchArray) => ({ file: relative(SRC, file), tag: m[0] })));

  it('reads a real corpus, so the rule is not passing over nothing', () => {
    expect(tags.length).toBeGreaterThan(20);
  });

  it('keeps the background the dialog component gives it', () => {
    const overriding: string[] = tags.filter(({ tag }) => SURFACE_OVERRIDE.test(tag)).map(({ file }) => file);
    expect(overriding).toEqual([]);
  });
});
