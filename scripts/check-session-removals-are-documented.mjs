/**
 * A session outlives its connection, and is removed only where CLAUDE.md says.
 *
 * `kernel/ext.rs` states the rule where a TCP drop is handled: sessions persist
 * across page navigations and reconnections. A drop never removes one.
 *
 * A path that broke this existed anyway. On a failed send to the localhost
 * client, `kernel/mod.rs` ran
 * `server_connection_map.retain(|_, v| v.associated_localhost_connection != uuid)`
 * -- deleting every session that connection owned. A failed send is the ORDINARY
 * case of a tab navigating between a request and its response, so a refresh at the
 * wrong moment logged the user out of every session in that tab. Silently: the log
 * line says the send failed.
 *
 * This gate was written for that line, as `check-sessions-are-removed-in-two-places`,
 * and it had its own blind spot: it matched `server_connection_map.remove(` and so
 * could not see a removal through a guard bound to a local --
 * `let mut lock = this.server_connection_map.write(); ... lock.remove(&cid)`, which
 * is exactly how the reconnect give-up (`reconnect/report.rs::fail`) removes. The
 * list said five paths while there were six, and "two places" had long been wrong.
 *
 * So removals are now found by what the receiver IS, not what it is called: every
 * `let` bound to a `server_connection_map` write guard, and every parameter typed
 * `&mut HashMap<u64, Connection<..>>`, is followed to its `.remove(` / `.retain(` /
 * `.clear(` / `.drain(` / `.extract_if(`. A later `let` of the same name to
 * anything else ends the binding.
 *
 * The list is the one CLAUDE.md documents ("Session Management & Resource
 * Cleanup"), and it must be exact in both directions:
 *   - a removal in a file not listed fails (a seventh path is a lifecycle change,
 *     to be argued for here and there);
 *   - a listed file with no removal fails (the entry is stale, or the scan broke);
 *   - a listed file CLAUDE.md does not name fails (the two lists have parted).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-internal-service', 'citadel-internal-service', 'src', 'kernel');
const DOC = join(ROOT, 'CLAUDE.md');
const DOC_SECTION = '## Session Management & Resource Cleanup';

if (!existsSync(KERNEL)) {
  console.error(
    `FAIL: ${relative(ROOT, KERNEL)} is not present, so this gate examined nothing.\n` +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

/** The files entitled to remove a session, as CLAUDE.md lists them, and why. */
const MAY_REMOVE = new Map([
  ['requests/peer/disconnect.rs', 'Disconnect: the user signed out of the current session'],
  [
    'requests/connection_management.rs',
    'DisconnectOrphan: the user signed out of a Previous Session, single or bulk; the ' +
      'single-session branch checks `may_disconnect` first',
  ],
  ['requests/deregister.rs', 'Deregister: the account is gone, removed once the protocol confirms it'],
  [
    'reconnect/report.rs',
    'the reconnect gave up (server refusal, 10 minutes unreachable, or past the hold window); ' +
      'recorded in GetSessions` signed_out',
  ],
  [
    'requests/connection_management_claim_sdk.rs',
    'ClaimSession found no SDK session behind the entry, so it drops a record of a session ' +
      'that already ended; skipped for a session the agent is reconnecting',
  ],
  ['requests/connect.rs', 'Connect replaces a stale entry for a session the SDK no longer holds'],
]);

const REMOVAL_METHOD = String.raw`(remove|retain|clear|drain|extract_if)`;
/** `server_connection_map.remove(`, `...server_connection_map.write().retain(`. */
const DIRECT = new RegExp(String.raw`server_connection_map\s*(?:\.\s*write\s*\(\s*\)\s*)?\.\s*${REMOVAL_METHOD}\s*\(`, 'g');
/** A `let` head; its right-hand side is read up to its own `;` (heads may nest). */
const LET = /\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?::[^=;{]*)?=/g;
const PARAM = /\b([A-Za-z_]\w*)\s*:\s*&\s*mut\s+HashMap\s*<\s*u64\s*,\s*Connection\b/g;

/** Comments blanked (positions kept), and the `#[cfg(test)]` module cut. */
function source(file) {
  const text = readFileSync(file, 'utf8');
  const testAt = text.search(/^\s*#\[cfg\(test\)\]/m);
  const live = testAt === -1 ? text : text.slice(0, testAt);
  return live.replace(/\/\/[^\n]*/g, (c) => ' '.repeat(c.length)).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Every session removal in `text`, as line numbers. */
export function removalsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(DIRECT)) found.add(lineAt(text, m.index));
  // name -> [{ at, guard }] in source order; the latest binding before a use decides.
  const bindings = new Map();
  const bind = (name, at, guard) => {
    if (!bindings.has(name)) bindings.set(name, []);
    bindings.get(name).push({ at, guard });
  };
  for (const m of text.matchAll(LET)) {
    const start = m.index + m[0].length;
    const end = text.indexOf(';', start);
    const rhs = text.slice(start, end === -1 ? undefined : end);
    // A block (`let x = { let mut lock = ...; ... }`) is not itself a guard; the
    // `let` inside it is found as a head of its own.
    const guard = !rhs.includes('{') && /server_connection_map/.test(rhs) && /\.\s*write\s*\(\s*\)/.test(rhs);
    bind(m[1], m.index, guard);
  }
  for (const m of text.matchAll(PARAM)) bind(m[1], m.index, true);
  for (const [name, list] of bindings) {
    if (!list.some((b) => b.guard)) continue;
    list.sort((a, b) => a.at - b.at);
    const use = new RegExp(String.raw`(?<![\w.])${name}\s*\.\s*${REMOVAL_METHOD}\s*\(`, 'g');
    for (const m of text.matchAll(use)) {
      const latest = list.filter((b) => b.at < m.index).at(-1);
      if (latest?.guard) found.add(lineAt(text, m.index));
    }
  }
  return [...found].sort((a, b) => a - b);
}

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const failures = [];
const removingFiles = new Set();
let filesRead = 0;
let removalsSeen = 0;
for (const file of rustFiles(KERNEL)) {
  filesRead += 1;
  const rel = relative(KERNEL, file);
  const lines = removalsIn(source(file));
  removalsSeen += lines.length;
  if (lines.length > 0) removingFiles.add(rel);
  if (lines.length > 0 && !MAY_REMOVE.has(rel)) {
    for (const line of lines) {
      failures.push(`citadel-internal-service/.../kernel/${rel}:${line}: removes a session, and is not one of the documented paths`);
    }
  }
}

for (const rel of MAY_REMOVE.keys()) {
  if (!removingFiles.has(rel)) failures.push(`${rel} is listed as removing a session and removes none: a stale entry, or this scan stopped seeing it`);
}

const doc = readFileSync(DOC, 'utf8');
const sectionAt = doc.indexOf(DOC_SECTION);
const nextAt = sectionAt === -1 ? -1 : doc.indexOf('\n## ', sectionAt + DOC_SECTION.length);
const section = sectionAt === -1 ? '' : doc.slice(sectionAt, nextAt === -1 ? undefined : nextAt);
if (section === '') failures.push(`CLAUDE.md has no "${DOC_SECTION}" section to compare against`);
for (const rel of MAY_REMOVE.keys()) {
  if (section !== '' && !section.includes(rel)) failures.push(`${rel} removes sessions but CLAUDE.md's "${DOC_SECTION}" does not name it`);
}

// Vacuity floor: finding no removals at all means the map is reached some other way now.
if (filesRead < 20 || removalsSeen === 0) {
  console.error(
    `FAIL: read ${filesRead} kernel file(s) and found ${removalsSeen} session removal(s).\n` +
      'A zero means `server_connection_map` is reached some other way now, not that the\n' +
      'kernel stopped removing sessions.',
  );
  process.exit(1);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`::error::${f}`);
  console.error(
    `\nFAIL: ${failures.length} problem(s) with where sessions are removed.\n` +
      '\nA session outlives its connection. A new path that ends one is a change to the session\n' +
      'lifecycle: add it to MAY_REMOVE with its reason AND to CLAUDE.md, so it reads as a\n' +
      'decision rather than an error-handling detail.',
  );
  process.exit(1);
}

console.log(
  `check-session-removals-are-documented: ${removalsSeen} session removal(s) across ${filesRead} kernel ` +
    `file(s), all in the ${MAY_REMOVE.size} paths CLAUDE.md documents, each of which removes one.`,
);
