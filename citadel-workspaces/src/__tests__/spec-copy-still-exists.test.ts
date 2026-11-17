/**
 * Copy a spec looks for must still exist in the app.
 *
 * Two CI failures this session came from checks pinned to wording that had been
 * improved:
 *
 *   - `getByRole('button', { name: /show password|hide password/i })` — the two
 *     toggles were renamed to "Show profile password" and "Show confirm profile
 *     password", because one name for two controls tells a screen-reader user
 *     nothing about which field they are on. The spec then found zero buttons
 *     and reported it six times, three per theme.
 *   - `getByRole('button', { name: 'Cancel' })` on the initialisation modal,
 *     whose button says "Not now" — "Cancel" is ambiguous on a modal you are
 *     declining rather than aborting. The spec reported "Dismissal Sticks: FAIL"
 *     for a feature that works.
 *
 * In both cases the app got better and the check went red. Addressing controls
 * by testid is the real fix and there is already a rule for that in `scripts/`;
 * this is the cheaper guard that covers the specs, where asserting on copy is
 * sometimes the point. It says only: if you name a control by its words, those
 * words must be somewhere in the source.
 *
 * **What that does and does not catch.** It catches copy that has vanished from
 * the app entirely. It does NOT catch copy that merely moved: "Show password"
 * still exists on the login form, and "Cancel" exists on a dozen buttons, so
 * neither of the two failures above would have tripped this rule. Stating that
 * plainly matters more than the rule looking better than it is — a guard whose
 * reach is overstated gets trusted past its evidence.
 *
 * It earned its place on the first run regardless, by finding a third instance
 * of the same class that nobody had noticed: `call-audio-video.spec.ts` asserted
 * a button named "unmute microphone" was visible, and no such name exists
 * anywhere. The mic label deliberately does not flip with the state — a label
 * that flipped alongside `aria-pressed` announced "Mute microphone, pressed" on
 * a LIVE mic, which a listener reads as muted. So that assertion was waiting on
 * a locator that can never resolve.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UI: string = resolve(__dirname, '../..');
const APP: string = join(UI, 'src');
const SPECS: string = join(UI, 'integration-tests', 'src');

function sourceFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

/** Every phrase a spec uses to ADDRESS a control, with where it says it. */
function addressedByCopy(): Map<string, string> {
  const found: Map<string, string> = new Map<string, string>();
  for (const file of sourceFiles(SPECS, ['.ts'])) {
    const source: string = readFileSync(file, 'utf-8');
    const where: string = file.slice(SPECS.length + 1);
    // getByRole('button', { name: 'Exact words' })
    for (const m of source.matchAll(/getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]/g)) {
      if (!found.has(m[1])) found.set(m[1], where);
    }
    // filter({ hasText: /^Exact words$/ })
    for (const m of source.matchAll(/hasText:\s*\/\^([A-Za-z][A-Za-z ]{1,28})\\\$\//g)) {
      if (!found.has(m[1])) found.set(m[1], where);
    }
    // getByRole('button', { name: /one|two/i }) — each alternative, if it is
    // plain words. A regex is how the password-toggle failure was written.
    for (const m of source.matchAll(/getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*\/([^/\n]+)\/[a-z]*\s*\}/g)) {
      for (const alternative of m[1].split('|')) {
        const phrase: string = alternative.replace(/[\^$]/g, '').trim();
        if (!/^[A-Za-z][A-Za-z ]{2,28}$/.test(phrase)) continue;
        if (!found.has(phrase)) found.set(phrase, where);
      }
    }
  }
  return found;
}

describe('copy a spec addresses a control by', () => {
  const app: string = sourceFiles(APP, ['.ts', '.tsx'])
    .map((f) => readFileSync(f, 'utf-8'))
    .join('\n')
    .toLowerCase();
  const phrases: Map<string, string> = addressedByCopy();

  it('finds the phrases it is written about', () => {
    // A rule over an empty set passes forever.
    expect(phrases.size).toBeGreaterThan(4);
  });

  it('reads a real app corpus', () => {
    expect(app.length).toBeGreaterThan(100_000);
  });

  it('still exists in the app', () => {
    const gone: string[] = [...phrases]
      .filter(([phrase]) => !app.includes(phrase.toLowerCase()))
      .map(([phrase, where]) => `${where}: "${phrase}"`);
    expect(gone).toEqual([]);
  });
});
