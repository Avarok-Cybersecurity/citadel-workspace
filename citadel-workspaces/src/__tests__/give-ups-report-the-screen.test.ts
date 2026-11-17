/**
 * A wait that gives up must say what was on the screen.
 *
 * The integration helpers used to end a failed wait with a bare line —
 * `Workspace loading timeout`, `Tree data loading timeout`, `✗ Timeout after
 * 30000ms`. A CI leg failing that way leaves nothing to work from: not the URL,
 * not whether a modal was sitting over the app, not what the page said. Two
 * failure families in this repository stayed "environmental and unexplained"
 * for weeks behind exactly that, and the first run with the screen attached
 * named the cause in one line: `dialogs: Connection Failed`.
 *
 * So `reportTimeout` is the only way to report a give-up, and a bare
 * `console.log` mentioning a timeout has to be one of the informational lines
 * listed below.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LIB: string = resolve(__dirname, '../../integration-tests/src/lib');

/**
 * Lines that MENTION a timeout without being one.
 *
 * Deliberately exact, and deliberately short: an allow-list that accepts a
 * pattern would accept the next give-up too.
 */
const INFORMATIONAL: string[] = [
  '[DEBUG] Waiting for message input to be visible (5s timeout)...',
  'Config: maxRetries=${maxRetries}, verifyTimeout=${verifyTimeout}ms',
];

/** `console.log(...)` calls with their literal argument text. */
function loggedMessages(source: string): string[] {
  const out: string[] = [];
  const call: RegExp = /console\.log\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    out.push(match[1].slice(1, -1).trim());
  }
  return out;
}

describe('a wait that gives up', () => {
  const files: string[] = readdirSync(LIB).filter((f) => f.endsWith('.ts'));

  it('scans the helper library, so the rule is not passing over nothing', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain('screen-state.ts');
  });

  it('reports the screen rather than a bare line', () => {
    const bare: string[] = [];
    for (const file of files) {
      if (file === 'screen-state.ts') continue;
      for (const message of loggedMessages(readFileSync(join(LIB, file), 'utf-8'))) {
        if (!/timeout|timed out/i.test(message)) continue;
        if (INFORMATIONAL.includes(message)) continue;
        bare.push(`${file}: ${message}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('has a reporter that captures more than the message it was given', () => {
    const reporter: string = readFileSync(join(LIB, 'screen-state.ts'), 'utf-8');
    // Each of these was worth its own line in the one run that used it.
    for (const field of ['url', 'dialogs', 'loading', 'headings', 'errors']) {
      expect(reporter).toContain(`${field}:`);
    }
    // By rectangle, not offsetParent: every dialog in this app is
    // `position: fixed`, and fixed elements report a null offsetParent — the
    // first version printed "dialogs: none" with a modal on the screen.
    // Comments are stripped first; the reason is written in one, and an
    // assertion that reads its own explanation as a violation is no assertion.
    const code: string = reporter
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain('getBoundingClientRect');
    expect(code).not.toContain('offsetParent');
  });
});
