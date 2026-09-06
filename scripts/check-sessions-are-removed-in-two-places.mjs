/**
 * A session outlives its connection. Only two requests may end one.
 *
 * `kernel/ext.rs` states the rule where a TCP drop is handled:
 *
 *     ALWAYS preserve sessions when TCP drops. Sessions should persist across
 *     page navigations and reconnections... Sessions are only explicitly cleaned
 *     up via: 1. Disconnect request (user-initiated logout) 2. Deregister request
 *     (account deletion)
 *
 * A third path existed anyway. On a failed send to the localhost client,
 * `kernel/mod.rs` ran
 * `server_connection_map.retain(|_, v| v.associated_localhost_connection != uuid)`
 * — deleting every session that connection owned. A failed send is the ORDINARY
 * case of a tab navigating between a request and its response, so a refresh at the
 * wrong moment logged the user out of every session in that tab, and a later claim
 * or reconnect found nothing to claim. Silently: the log line says the send failed.
 *
 * The rule this enforces is narrow on purpose. It does not ask WHY a file removes
 * a session, only that the removal happens in a file whose job that is. A fourth
 * such site is not necessarily wrong — but it is a change to the session lifecycle,
 * and it should be a decision rather than a line added to an error branch.
 *
 * The allow-list is longer than the comment in `ext.rs`, and deliberately so.
 * Three further files remove sessions, and each is one of the two named kinds
 * wearing a different name:
 *
 *   - `connection_management.rs` — DisconnectOrphan, single and bulk. That IS
 *     user-initiated logout; it signs out a session the user is looking at in
 *     the Previous Sessions list rather than the one in front of them. The
 *     single-session branch checks `may_disconnect` first.
 *   - `connection_management_claim.rs` and `connect.rs` — a map entry for a
 *     session the SDK no longer holds. Neither ends a live session; both drop a
 *     record of one that is already gone, which is the documented reconnect
 *     path in CLAUDE.md.
 *
 * So the rule is not "two files". It is: ending a session is a decision about
 * the session lifecycle, and it belongs in a file whose job that is, with a
 * reason recorded here. The line this gate was written for had neither — it sat
 * in the error branch of a failed response send.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-internal-service', 'citadel-internal-service', 'src', 'kernel');

if (!existsSync(KERNEL)) {
  console.error(
    `FAIL: ${relative(ROOT, KERNEL)} is not present, so this gate examined nothing.\n` +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

/** Files entitled to remove a session, and why each one is. */
const MAY_REMOVE = new Map([
  ['requests/deregister.rs', 'account deletion — the account itself is going'],
  ['requests/peer/disconnect.rs', 'user-initiated logout'],
  [
    'requests/connect.rs',
    'replaces a stale entry for a session the SDK no longer holds, which is the ' +
      'documented reconnect path rather than a logout',
  ],
  [
    'requests/connection_management.rs',
    'DisconnectOrphan — user-initiated logout of a session other than the current ' +
      'one; the single-session branch checks `may_disconnect` first',
  ],
  [
    'requests/connection_management_claim.rs',
    'ClaimSession found no SDK session behind the entry, so it drops a record of a ' +
      'session that has already ended rather than ending one',
  ],
]);

/** Taking a session out of the map, by either shape. */
const REMOVES_SESSION = /server_connection_map\s*(?:\.\s*write\s*\(\s*\)\s*)?\.\s*(remove|retain)\s*\(/;

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const offenders = [];
let filesRead = 0;
let removalsSeen = 0;

for (const file of rustFiles(KERNEL)) {
  filesRead += 1;
  const rel = relative(KERNEL, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  const testModAt = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
  const limit = testModAt === -1 ? lines.length : testModAt;

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment removes nothing
    if (!REMOVES_SESSION.test(line)) continue;
    removalsSeen += 1;
    if (MAY_REMOVE.has(rel)) continue;
    offenders.push(
      `citadel-internal-service/.../kernel/${rel}:${i + 1}: removes a session outside the ` +
        'two requests entitled to',
    );
  }
}

// Vacuity floor: the sanctioned sites exist, so finding no removals at all means
// the accessor was renamed and this gate is reporting over nothing.
if (filesRead < 20 || removalsSeen === 0) {
  console.error(
    `FAIL: read ${filesRead} kernel file(s) and found ${removalsSeen} session removal(s).\n` +
      'A zero means `server_connection_map` is reached some other way now, not that the\n' +
      'kernel stopped removing sessions.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} session removal(s) outside the sanctioned paths.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nA session outlives its connection. `kernel/ext.rs` states it: sessions persist across\n' +
      'page navigations and reconnections, and are cleaned up only by Disconnect (logout) or\n' +
      'Deregister (account deletion).\n' +
      '\nThe last line that broke this sat in the error branch of a failed response send —\n' +
      'the ordinary case of a tab navigating away — and logged the user out of every session\n' +
      'in that tab.\n' +
      '\nIf a new path genuinely needs to end a session, add it to MAY_REMOVE with the reason,\n' +
      'so it reads as a change to the session lifecycle rather than an error-handling detail.',
  );
  process.exit(1);
}

console.log(
  `check-sessions-are-removed-in-two-places: ${removalsSeen} session removal(s) across ` +
    `${filesRead} kernel file(s), all in the ${MAY_REMOVE.size} paths entitled to.`,
);
