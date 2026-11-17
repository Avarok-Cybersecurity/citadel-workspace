/**
 * Anything with an onClick must be operable without a mouse.
 *
 * A `<div onClick>` with no role, no `tabIndex` and no key handler is invisible
 * to a keyboard and announces nothing to a screen reader. axe catches some of
 * these and not others, and the keyboard-reachability check in
 * `check-accessibility.mjs` cannot see them at all: they are not in its selector
 * list, because they are not buttons, links or form fields. That is the same
 * gap round 215 found for the slider thumb — the instrument decides what exists.
 *
 * The tree is clean today, so this is a lock rather than a repair.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC: string = resolve(__dirname, '..');

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

/**
 * The whole opening tag, scanned brace-aware.
 *
 * The first version stopped at the first `>` after the tag name. In JSX that is
 * routinely the arrow of `onClick={() => …}`, so the slice ended mid-handler and
 * never saw the `role`, `tabIndex` and `onKeyDown` that followed. It reported
 * four violations and every one of them was already correct — a detector that
 * manufactures defects is worse than none, because someone acts on it.
 */
function openingTag(source: string, start: number): string {
  let depth: number = 0;
  for (let i: number = start; i < source.length; i += 1) {
    const c: string = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start, start + 400);
}

describe('clickable non-interactive elements', () => {
  const files: string[] = tsxFiles(SRC);

  it('scans a real corpus, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => readFileSync(f, 'utf-8').includes('onClick='))).toBe(true);
  });

  it('are keyboard-operable', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source: string = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/<(div|span|li|td|tr)\b/g)) {
        const tag: string = openingTag(source, match.index);
        if (!tag.includes('onClick=')) continue;
        if (/\brole=|\bonKeyDown|\btabIndex/.test(tag)) continue;
        const line: number = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
