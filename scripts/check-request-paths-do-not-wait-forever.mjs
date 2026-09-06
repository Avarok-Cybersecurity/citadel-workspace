/**
 * A request handler must not await something with no bound.
 *
 * `requests/connect.rs` opened a `GetActiveSessions` subscription between the
 * successful SDK connect and building the `Connection`, and awaited
 * `stream.next()` with no timeout. It was labelled `// DEBUG:` and its only
 * consumer was the `info!` that printed the result. `requests/peer/register.rs`
 * carried the identical block.
 *
 * A subscription that never yields therefore left LOGIN permanently unanswered,
 * with the last log line reading "Querying active sessions after connect..." —
 * which reads as an SDK connect failure rather than as a discarded debug query.
 * Every other SDK query in this tree is bounded: `PEER_LIST_TIMEOUT`,
 * `PEER_SEND_TIMEOUT`, the 30s `connect_to_peer_custom`.
 *
 * THE RULE: inside `kernel/requests/**`, an `.await` on a subscription stream
 * must be inside a timeout. The user is holding a spinner on the other end of
 * every one of these, and "forever" is not a failure mode they can act on.
 *
 * WHAT THIS CANNOT SEE: an await that is bounded by the remote's own internal
 * timeout rather than by a visible one here. That is why the rule is narrow —
 * it looks for the subscription-stream shape specifically, which is the one
 * that has no such bound.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REQUESTS = join(
  ROOT, 'citadel-internal-service', 'citadel-internal-service', 'src', 'kernel', 'requests',
);

if (!existsSync(REQUESTS)) {
  console.error('FAIL: the agent request handlers are not present — this gate examined nothing.');
  process.exit(1);
}

/** Opening a callback subscription: the shape whose stream has no bound. */
const OPENS_SUBSCRIPTION = /send_callback_subscription\s*\(/;

/**
 * A bound, in any of the forms this tree uses — and it uses several.
 *
 * The first version recognised only `timeout(` and `_TIMEOUT`, and immediately
 * reported three sites that are correctly bounded by constants named
 * `GROUP_REQUEST_JOIN_WAIT`, `GROUP_RESPOND_WAIT` and `DELETE_WAIT`, consumed
 * through `await_*_outcome` helpers that exist precisely to apply them. Three
 * invented findings out of five is the ratio that gets a gate switched off, and
 * this gate would have been reporting the fix as the defect.
 */
const BOUNDED = /timeout\s*\(|_TIMEOUT\b|_WAIT\b|with_timeout|tokio::time::|await_\w+_outcome\s*\(/;

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const problems = [];
let filesRead = 0;
let subscriptionsSeen = 0;

for (const file of rustFiles(REQUESTS)) {
  filesRead += 1;
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  const testAt = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
  const limit = testAt === -1 ? lines.length : testAt;

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment awaits nothing
    if (!OPENS_SUBSCRIPTION.test(line)) continue;
    subscriptionsSeen += 1;

    // Is the stream this opens consumed under a bound? Look at the block that
    // follows — generously, since rustfmt spreads these over many lines.
    const block = lines.slice(Math.max(0, i - 6), Math.min(i + 24, limit)).join('\n');
    if (BOUNDED.test(block)) continue;

    problems.push(
      `${rel}:${i + 1}: opens a callback subscription and awaits its stream with no timeout — ` +
        'a subscription that never yields leaves this request permanently unanswered',
    );
  }
}

// Vacuity floor: these handlers exist and are numerous. Reading almost none
// means the tree moved and this gate reports safety over nothing.
if (filesRead < 15) {
  console.error(
    `FAIL: read ${filesRead} request handler(s); far too few. The path moved, so this gate\n` +
      'examined essentially nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} unbounded await(s) on a request path.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nBound it, as every other SDK query here is bounded (PEER_LIST_TIMEOUT,\n' +
      'PEER_SEND_TIMEOUT, the 30s connect_to_peer_custom) — or delete it, if the only\n' +
      'consumer was a log line, which is what the last two of these were.\n' +
      '\nSomeone is holding a spinner on the other end of every one of these requests, and\n' +
      '"forever" is not a failure mode they can act on.',
  );
  process.exit(1);
}

console.log(
  `check-request-paths-do-not-wait-forever: ${subscriptionsSeen} callback subscription(s) across ` +
    `${filesRead} request handler(s); none awaits its stream unbounded.`,
);
