/**
 * A LocalDB response must be classified by its VARIANT, never by its presence.
 *
 * The messenger backend asks the agent to store and load the queues that make
 * messaging durable: the outbound map, the inbound map, the delivery frontier,
 * the next-id counter. Five call sites answered "did that work?" in four
 * different ways, and two of them were wrong in the direction that loses data
 * without saying so.
 *
 *   - `update_map` and `store_value` used `wait_for_response(id).await.is_some()`.
 *     A `LocalDBSetKVFailure` IS a response, and the agent sends one on a backend
 *     error, on a failed `propose_target`, and on the ownership-gate refusal. So a
 *     refused write returned `Ok(())`, the map read as stored, ILM read as queued,
 *     and the sender saw a message as sent that nothing would retransmit. The
 *     comment beneath each claimed to prevent exactly that, and
 *     `store_values_batched` said all three "must agree" -- they never did.
 *   - `load_values_batched` and `load_value` folded every non-success into
 *     `None`, so a backend error read as "no such key". `MessageTracker::new`
 *     then starts with an empty delivery frontier: messages already received are
 *     re-delivered, ACK state resets, and the id counter restarts.
 *
 * Both decisions now live in one place each -- `write_outcome` and `read_outcome`
 * in `messenger/backend.rs` -- and are unit-tested against real response values.
 * This gate exists for the SIXTH site: a new call written the old way would
 * compile, pass every test, and reintroduce the same silent loss.
 *
 * What it forbids, in the connector's messenger only:
 *   1. `wait_for_response(..).await.is_some()` -- presence used as success.
 *   2. a catch-all arm mapping an unmatched response to `Ok(None)` or `None`,
 *      inside a function that reads a LocalDB value.
 *
 * It does NOT try to prove the classification is correct; the unit tests do that.
 * It proves nobody bypassed it.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSENGER = join(
  ROOT,
  'citadel-internal-service',
  'citadel-internal-service-connector',
  'src',
  'messenger',
);

if (!existsSync(MESSENGER)) {
  console.error(
    `FAIL: ${relative(ROOT, MESSENGER)} is not present, so this gate examined nothing.\n` +
      'Run `git submodule update --init --recursive` first. Passing here would mean\n' +
      'reporting a clean bill over a directory that was never opened.',
  );
  process.exit(1);
}

/** Presence of a reply used as proof of success. */
const PRESENCE_AS_SUCCESS = /wait_for_response\s*\([^)]*\)\s*\.await\s*\.is_some\s*\(\s*\)/;

/**
 * A catch-all that answers "absent". `_ => None` and `_ => Ok(None)`, plus the
 * `other =>` spelling. A named binding that is then INSPECTED is fine -- it is
 * the discarding that loses the distinction.
 */
const CATCHALL_ABSENT = /^\s*(?:_|other)\s*=>\s*(?:Ok\(\s*None\s*\)|None)\s*,?\s*$/;

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const offenders = [];
let filesRead = 0;
let linesRead = 0;

for (const file of rustFiles(MESSENGER)) {
  filesRead += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  linesRead += lines.length;

  // Only inside the module that talks to LocalDB; `#[cfg(test)]` fixtures below
  // it legitimately construct whatever they like.
  const testModAt = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
  const limit = testModAt === -1 ? lines.length : testModAt;

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment cannot run
    if (PRESENCE_AS_SUCCESS.test(line)) {
      offenders.push(
        `${rel}:${i + 1}: a reply's PRESENCE used as success — use write_outcome()\n      ${line.trim()}`,
      );
    }
    if (CATCHALL_ABSENT.test(line) && /LocalDBGetKV|read_outcome|load_value/.test(lines.slice(Math.max(0, i - 25), i + 1).join('\n'))) {
      offenders.push(
        `${rel}:${i + 1}: an unmatched response answered "absent" — use read_outcome()\n      ${line.trim()}`,
      );
    }
  }
}

// Vacuity floor: the directory exists but the walk or the extension filter moved.
if (filesRead === 0 || linesRead < 200) {
  console.error(
    `FAIL: read ${filesRead} file(s) / ${linesRead} line(s) under ${relative(ROOT, MESSENGER)} — ` +
      'far too few for this module, so the walk moved and nothing was examined.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o.split('\n')[0]}`);
  console.error(`\nFAIL: ${offenders.length} LocalDB response(s) classified by presence rather than variant.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nRoute the decision through `write_outcome` or `read_outcome` in messenger/backend.rs.\n' +
      'They are pure functions with unit tests covering refusal, failure, the wrong\n' +
      'variant, a genuine miss, and a timeout. A refused write reported as stored is a\n' +
      'message the sender saw as sent and nothing will ever retransmit.',
  );
  process.exit(1);
}

console.log(
  `check-localdb-responses-are-classified: ${filesRead} file(s), ${linesRead} line(s) in the ` +
    'messenger; every LocalDB response is classified by variant.',
);
