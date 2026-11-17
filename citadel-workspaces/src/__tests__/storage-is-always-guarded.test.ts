/**
 * No module may touch `sessionStorage` directly.
 *
 * The accessor throws outright under strict privacy settings, enterprise policy
 * and some embedded contexts — it does not return null, it raises a
 * `SecurityError`. Several callers here run during boot, and unguarded the app
 * did not mount, did not reach the root error boundary, and rendered an **empty
 * body**. A blank page is worse than a crash screen: there is nothing on screen
 * to report and nothing in the UI to act on.
 *
 * `localStorage` was wrapped at every site in this codebase. Its sibling was
 * wrapped at none — the same one-of-two shape this campaign keeps finding.
 *
 * The guard is a rule rather than six try/catch blocks, so the next caller
 * inherits it instead of re-deciding it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC: string = resolve(__dirname, '..');
/** The one module allowed to touch it: the guard itself. */
const GUARD: "lib/safe-session-storage.ts" = 'lib/safe-session-storage.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('sessionStorage', () => {
  const files: string[] = sourceFiles(SRC);

  it('scans a real corpus, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(GUARD))).toBe(true);
  });

  it('is only touched through the guard', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative: string = file.slice(SRC.length + 1);
      if (relative === GUARD) continue;
      const source: string = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\bsessionStorage\s*\./.test(source)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
