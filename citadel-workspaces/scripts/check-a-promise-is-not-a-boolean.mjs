#!/usr/bin/env node
/**
 * No declared type unions a boolean with a Promise.
 *
 * `conversation-manager.ts` had:
 *
 *   const isOnline: true | Promise<boolean | null> =
 *     isConnectedLocal || p2pAutoConnectService.isPeerConnected(cid) || isOnlineRegistration;
 *
 * `isPeerConnected` is async. A pending Promise is truthy, so `isOnline` was
 * true whenever the local map said false -- which is every peer at the moment
 * its conversation is created. Every new conversation opened as Online with
 * `lastUpdate: Date.now()`, presence invented from a value nobody awaited.
 *
 * The type said it out loud. A union of a boolean with a Promise is not a
 * design; it is a missing `await` that the annotation was widened to accept.
 *
 * `@typescript-eslint/no-misused-promises` is enabled and does catch the
 * direct forms -- `if (promise)`, `promise ? a : b` -- but it stayed silent on
 * this one, because the chain ends in a boolean operand and the resulting union
 * has non-Promise members. Verified both ways: a probe `if` in the same file
 * fired, this line never did. Hence this check as well, not instead.
 *
 * Deliberately narrow. `Promise<T> | null` for a cached in-flight request is a
 * real pattern used a dozen times here and is not what this looks for.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** boolean-ish on one side of the union, Promise on the other. */
const BOOL_THEN_PROMISE = /:\s*(?:true|false|boolean)\s*\|[^=;]*Promise\s*</;
const PROMISE_THEN_BOOL = /:\s*[^=;]*Promise\s*<[^=;]*>\s*\|\s*(?:true|false|boolean)\b/;

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const problems = [];
let checked = 0;

for (const file of files(SRC)) {
  checked += 1;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Prose is not code. The doc comment on `initial-presence.ts` quotes the
    // very declaration this looks for, to explain why it was wrong -- and the
    // first draft of this check reported it. A gate that flags its own
    // explanation is a gate people learn to switch off.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    if (BOOL_THEN_PROMISE.test(line) || PROMISE_THEN_BOOL.test(line)) {
      problems.push([`${file.slice(SRC.length - 3)}:${i + 1}`, line.trim().slice(0, 120)]);
    }
  });
}

if (problems.length > 0) {
  console.error('\n  A boolean unioned with a Promise:\n');
  for (const [where, what] of problems) console.error(`::error::${where} — ${what}`);
  console.error(
    '\n  Await it, or take the value from a source that answers synchronously.\n' +
    '  A pending Promise is truthy, so this reads as `true` every time.\n',
  );
  process.exit(1);
}

console.log(`  Promises are not booleans: ${checked} file(s) checked  ok`);
