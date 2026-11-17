/**
 * Every wait for a response must end when the socket does.
 *
 * `requestResponse` learned this first. Ten other files hand-roll the same
 * wait — file transfers at 30s and 60s, the file picker at 120s, peer lists at
 * 35s — and each of those was a spinner running to its full budget over a
 * socket that was already gone, ending in "timed out", which names the wrong
 * cause. The internal service keys responses to the connection that asked, and
 * a reconnect is a new connection, so a request in flight at the drop can never
 * be answered.
 *
 * This is the shape this repository keeps recording: a correct fix applied in
 * one place. The rule is here so the eleventh waiter cannot be written without
 * it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LIB: string = resolve(__dirname, '../..');

/** The module that DEFINES the handling, and the copy that only names it. */
const EXEMPT: string[] = ['websocket/request-response.ts', 'error-messages.ts'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('a hand-rolled wait for a response', () => {
  const files: string[] = sourceFiles(LIB);

  it('scans the library, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('finds the waiters it is written about', () => {
    const waiters: string[] = files.filter((f) => /reject\(\s*new Error\([^)]*timed out/.test(readFileSync(f, 'utf-8')));
    // Ten of them, and the count is asserted so a refactor that hides the
    // pattern behind a different phrasing shows up here rather than silently
    // emptying the rule below.
    expect(waiters.length).toBeGreaterThanOrEqual(8);
  });

  it('always fails when the socket drops', () => {
    const unguarded: string[] = [];
    for (const file of files) {
      const relative: string = file.slice(LIB.length + 1);
      if (EXEMPT.includes(relative)) continue;
      // Comments and imports stripped, and a CALL required.
      //
      // This was `source.includes('failOnSocketLoss')` against raw source, so
      // a file counted as guarded when the WORD appeared anywhere in it --
      // including in a comment explaining why the guard matters.
      // peer-registration-store/persistence.ts already carries such a comment,
      // so deleting its actual call would have left this green.
      const source: string = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/^\s*import[^;]*;/gm, '');
      if (!/reject\(\s*new Error\([^)]*timed out/.test(source)) continue;
      if (/\b(failOnSocketLoss|requestResponse)\s*(?:<[^>]*>)?\(/.test(source)) continue;
      unguarded.push(relative);
    }
    expect(unguarded).toEqual([]);
  });
});
