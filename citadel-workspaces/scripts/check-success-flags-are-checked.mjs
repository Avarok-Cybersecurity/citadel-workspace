/**
 * A function that answers "did that work?" whose answer nobody reads.
 *
 * `sendAndAwaitAck` was changed to return a boolean precisely so an
 * unacknowledged RE-VFS operation would stop being invisible. Every one of its
 * six callers then awaited it, discarded it, and returned `Promise<void>` --
 * and so did the service, both hooks and the file-manager handlers above them.
 * `peerRmdir` went as far as writing `NOT acknowledged by peer` to a debug log
 * before returning void. The file manager announced "Deleted" for peers that
 * had never heard of the change.
 *
 * The same shape put a retracted P2P message back on screen after a reload: the
 * paginated store's write result was the only evidence the removal had not
 * happened, and nothing read it.
 *
 * Both were found by asking the type checker which call expressions resolve to
 * a boolean and are used as statements. This keeps asking.
 *
 * Only functions declared in THIS project count. `Map.delete`, `Set.delete` and
 * `classList.toggle` return booleans nobody is expected to read, and they
 * outnumber the real signal ten to one.
 *
 * Ratcheted: today's discards are recorded, a NEW one fails, and removing one
 * shrinks the file. Not every entry is a bug -- `requestResponse<true>` rejects
 * on failure, and the WASM send throws when no messenger handle exists -- but
 * every entry is a place where the only report of failure is being dropped, and
 * that is worth having to justify.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDiscards } from './success-flags-core.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptsDir, '..');
const BASELINE = resolve(scriptsDir, 'discarded-success-flags.baseline.json');

const found = findDiscards(root);

const counts = {};
for (const key of found.sort()) counts[key] = (counts[key] ?? 0) + 1;

if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`  Success flags: recorded ${found.length} existing discard(s) -- commit the baseline  FAIL`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const added = [];
for (const [key, count] of Object.entries(counts)) {
  const allowed = baseline[key] ?? 0;
  if (count > allowed) added.push(`${key}  (${allowed} allowed, ${count} found)`);
}

if (added.length > 0) {
  console.error(`  Success flags: ${added.length} new discarded success flag(s)  FAIL`);
  for (const entry of added) console.error(`    ${entry}`);
  console.error('');
  console.error('  This call answers whether the operation worked and the answer is dropped.');
  console.error('  Either act on it -- report it, retry, or return it to a caller who can --');
  console.error('  or, if failure genuinely surfaces some other way (a throw, a rejection,');
  console.error('  an internal notification), say which in a comment at the call site.');
  process.exit(1);
}

const shrank = Object.keys(baseline).length !== Object.keys(counts).length ||
  Object.entries(baseline).some(([k, v]) => (counts[k] ?? 0) !== v);
if (shrank) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`  Success flags: down to ${found.length} discard(s) -- baseline rewritten, commit it  FAIL`);
  process.exit(1);
}

console.log(`  Success flags: no new discarded success flags (${found.length} in the baseline)  ok`);
