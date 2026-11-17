/**
 * A gate must not force a click.
 *
 * `page.click({ force: true })` skips the check that the element is the one
 * which will receive the click. It therefore hides two defects outright:
 *
 *   1. Something is covering the control. At 375px an ambient toast sat on the
 *      join form's submit button; the forced click went to the toast, the form
 *      never submitted, and three plausible explanations for the resulting
 *      "focus bug" were all wrong (round 230).
 *   2. The control is disabled. Settings > Connect and Settings > Perms carry
 *      `disabled` with "Connect to a workspace first" when there is no session.
 *      The forced click went through it, the tab never changed, and two of five
 *      settings surfaces in two gates were scanning whichever tab was already
 *      open, reported under someone else's name (round 231).
 *
 * Both are exactly what a browser-driving gate exists to catch. Waiting for
 * actionability is not a slower click; it is the assertion.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRIPTS: string = resolve(__dirname, '../../scripts');

function scriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...scriptFiles(path));
    else if (entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

describe('the browser gates', () => {
  const files: string[] = scriptFiles(SCRIPTS);

  it('scan a real set of scripts', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never force a click', () => {
    const forced: string[] = [];
    for (const file of files) {
      const source: string = readFileSync(file, 'utf-8');
      // `.click({ force: true })` only — `rm(dir, { force: true })` is a
      // filesystem call and has nothing to do with this.
      //
      // Line by line, skipping comments. A gate that explains why forcing a
      // click is wrong has to quote the thing it forbids, and this used to
      // count that prose: `check-forced-clicks-are-justified.mjs` failed here
      // for its own docstring. A check that flags its own explanation is one
      // people learn to switch off.
      source.split('\n').forEach((text: string, index: number): void => {
        const trimmed: string = text.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
        if (/\.click\(\s*\{[^}]*force:\s*true/.test(text)) {
          forced.push(`${file.slice(SCRIPTS.length + 1)}:${index + 1}`);
        }
      });
    }
    expect(forced).toEqual([]);
  });
});
