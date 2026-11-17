#!/usr/bin/env node
/**
 * A clickable element a keyboard can reach.
 *
 * `onClick` on a `<div>` or `<span>` is invisible to the keyboard and to
 * assistive technology: no focus, no Enter, no Space, no announced role. The
 * codebase already knows this -- `lib/a11y.ts` exports `activateOnKey`, and
 * every such element found today pairs it with `role` and `tabIndex`. This
 * keeps that true, because the next one is written by whoever is in a hurry.
 *
 * Native interactive elements (`button`, `a`, `input`, ...) are reachable by
 * construction and are not checked.
 *
 * The parse is deliberate. A first pass of this read a fixed number of lines
 * after the tag and reported four elements that were all correct -- their
 * `role` and `tabIndex` sat past the window. A check that reports working code
 * teaches people to skip it, so this one reads to the END of the opening tag,
 * counting braces AND skipping quoted strings -- `className={...}` and
 * `className="a > b"` both contain `>` that do not close anything.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');

/** Elements with no built-in interactive behaviour. */
const INERT = /<(div|span|li|td|tr|p|section|article|header|footer|nav|label)\b/g;

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') yield* files(full);
    } else if (entry.endsWith('.tsx')) yield full;
  }
}

/** From `<`, return the text of the opening tag, ending at the `>` that closes it. */
function openingTag(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      // A `>` inside `className="a > b"` is not the end of the tag. Its own
      // control proved this: an element whose onClick came after such a string
      // was reported as fine.
      if (c === quote && source[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start, start + 2000);
}

const problems = [];
let checked = 0;

for (const file of files(SRC)) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(INERT)) {
    const tag = openingTag(source, m.index);
    if (!/\bonClick=/.test(tag)) continue;
    checked += 1;
    const reachable = /\brole=/.test(tag) && /\btabIndex=/.test(tag);
    if (!reachable) {
      const line = source.slice(0, m.index).split('\n').length;
      problems.push([`${relative(ROOT, file)}:${line}`, `<${m[1]}> has onClick but no role and tabIndex`]);
    }
  }
}

if (problems.length > 0) {
  console.error('\n  Clickable elements a keyboard cannot reach:\n');
  for (const [where, why] of problems) console.error(`::error::${where} — ${why}`);
  console.error(
    '\n  Give it `role`, `tabIndex={0}` and `onKeyDown={activateOnKey(...)}` from\n' +
    '  lib/a11y.ts -- or use a <button>, which needs none of them.\n',
  );
  process.exit(1);
}

console.log(`  Keyboard reachability: ${checked} clickable non-interactive element(s), all reachable  ok`);
