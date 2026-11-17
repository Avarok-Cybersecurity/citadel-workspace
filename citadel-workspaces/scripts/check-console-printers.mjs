/**
 * No console listener truncates the message itself.
 *
 * `diagnostics.ts` printed `text.substring(0, 150)`, and the WASM tracing
 * formatter puts around 110 characters of prefix in front of every line — so
 * `[ILM-BLOCKED-RECOVERY] CID 15079777622326333560 -> peer 15079777622326333560`
 * reached CI as `peer 15`, with nothing to say it had been cut. `15` is a
 * plausible CID.
 *
 * That was fixed, and `browser.ts` had the same `substring(0, 150)` — in the
 * helper the `[Alice]` / `[Bob]` lines in those very logs came from. One fix,
 * two call sites, and the one that was actually producing the broken output
 * was the one left alone.
 *
 * So: a file that registers a `page.on('console')` handler may not slice or
 * truncate the message text. `formatConsoleLine` trims the parts that carry no
 * information first and marks what it does cut.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, 'integration-tests', 'src');

const REGISTERS_LISTENER = /page\.on\(\s*['"]console['"]/;
/** `text.slice(0, 300)`, `msg.text().substring(0, 150)`, and friends. */
const TRUNCATES_TEXT = /\b(?:text|msg\.text\(\))\s*\.\s*(?:slice|substring)\s*\(\s*0\s*,/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf-8');
  if (!REGISTERS_LISTENER.test(source)) continue;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (TRUNCATES_TEXT.test(lines[i])) offenders.push([relative(APP, file), i + 1, lines[i].trim()]);
  }
}

if (offenders.length > 0) {
  console.error('\n  Console listeners that truncate the message themselves:\n');
  for (const [file, line, text] of offenders) {
    console.error(`::error file=citadel-workspaces/${file},line=${line}::${text}`);
  }
  console.error(
    '\n  Use formatConsoleLine from integration-tests/src/lib/console-line.ts.\n' +
    '  It drops the tracing prefix before spending the budget, and marks what\n' +
    '  it cuts — a truncated diagnostic that reads as complete is worse than none.\n',
  );
  process.exit(1);
}

const listeners = walk(ROOT).filter((f) => REGISTERS_LISTENER.test(readFileSync(f, 'utf-8'))).length;
console.log(`  Console printers: ${listeners} listener(s), none truncating the message  ok`);
