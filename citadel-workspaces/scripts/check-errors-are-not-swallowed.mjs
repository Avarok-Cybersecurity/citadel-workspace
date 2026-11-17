#!/usr/bin/env node
/**
 * No production catch discards its error without saying why.
 *
 * CLAUDE.md: "Fail fast — never silently swallow errors." The codebase already
 * lives by it — thirty catches carry a comment explaining the decision, and a
 * documented choice to ignore something is not a silent one. Three did not, and
 * two of those mattered: a peer-connection sync whose failure leaves every P2P
 * feature working from a stale roster, and a `stopRing()` whose failure leaves
 * the ringtone playing. Both present as protocol faults with no line anywhere
 * saying otherwise.
 *
 * A catch may still ignore an error. It may not do so without a word about it —
 * either a handler that logs, or a comment saying why silence is right.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const SRC = resolve(dirname(new URL(import.meta.url).pathname), '..', 'src');

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') yield* files(full);
    } else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const problems = [];
let checked = 0;

for (const file of files(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // `.catch(() => {})` with nothing said about it, on this line or the last.
    if (/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
      checked += 1;
      const previous = (lines[i - 1] ?? '').trim();
      const documented = previous.startsWith('//') || previous.startsWith('*') || /\/\//.test(line);
      if (!documented) {
        problems.push([`${relative(SRC, file)}:${i + 1}`, line.trim().slice(0, 80)]);
      }
      return;
    }
    // A `catch { }` block whose body is empty.
    if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) {
      checked += 1;
      const body = [];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
        const text = lines[j].trim();
        if (text === '}') break;
        body.push(text);
      }
      if (body.length === 0) {
        problems.push([`${relative(SRC, file)}:${i + 1}`, 'catch block is empty']);
      }
    }
  });
}

if (problems.length > 0) {
  console.error('\n  Errors discarded without a word:\n');
  for (const [where, what] of problems) console.error(`::error::${where} — ${what}`);
  console.error(
    '\n  Log it, or say in a comment why silence is right. Ignoring an error on\n' +
    '  purpose is a decision; ignoring one by omission is how a stale roster or\n' +
    '  a ringtone that will not stop reads as a protocol fault.\n',
  );
  process.exit(1);
}

console.log(`  Swallowed errors: ${checked} catch site(s) examined, all accounted for  ok`);
