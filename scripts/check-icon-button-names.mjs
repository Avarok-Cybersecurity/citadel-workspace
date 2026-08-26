#!/usr/bin/env node
/**
 * Fails if an icon-only Button has no accessible name.
 *
 * axe reports these as `critical button-name`, but only for buttons that are
 * ON SCREEN during a scan. Seven were found in one sweep here and only ONE of
 * them was reachable by the accessibility suite: the composer's send button.
 * The others sit behind state the scans never reach — message action menus
 * need messages, and a freshly registered workspace has none, so the Messages
 * scan renders an empty thread and passes.
 *
 * A green axe run therefore says nothing about the rest of them, which is why
 * this checks the source instead of the DOM.
 *
 * An icon-only Button is `<Button ... size="icon">` whose children render no
 * text. Any of aria-label, title, or an .sr-only child counts as a name.
 *
 * Pure file reads: no toolchain, no browser, no network.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspaces', 'src');

if (!existsSync(SRC)) {
  console.log('check-icon-button-names: citadel-workspaces/src absent (submodule not checked out); skipping.');
  process.exit(0);
}

/** Every .tsx under src, excluding tests. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      out.push(...walk(p));
    } else if (entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<Button\b((?:[^>]|\n)*?)>((?:.|\n)*?)<\/Button>/g)) {
    const [, attrs, inner] = match;
    if (!/size="icon"/.test(attrs)) continue;
    scanned += 1;
    if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
    if (/sr-only/.test(inner)) continue;
    // Children that render literal text give it a name; strip tags and JSX
    // expressions and see whether anything is left.
    const text = inner.replace(/<[^>]*>/g, '').replace(/\{[^{}]*\}/g, '').trim();
    if (text) continue;
    const line = source.slice(0, match.index).split('\n').length;
    offenders.push(`${relative(ROOT, file)}:${line}`);
  }
}

if (offenders.length > 0) {
  console.error(
    `check-icon-button-names: ${offenders.length} icon-only Button(s) render no text and have no accessible name.\n` +
      'A screen reader announces nothing for these. Add aria-label (and aria-hidden on the icon).\n',
  );
  for (const o of offenders) console.error(`  ${o}`);
  console.error('');
  process.exit(1);
}

console.log(`check-icon-button-names: OK — all ${scanned} icon-only Button(s) have an accessible name.`);
