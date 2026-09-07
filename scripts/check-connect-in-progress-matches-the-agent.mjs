#!/usr/bin/env node
/**
 * The UI's "already connecting" test must match what the agent actually sends.
 *
 * `requests/connect.rs` refuses a duplicate connect with
 *
 *   "Connection already in progress for user {username}"
 *
 * Three UI sites tested for that with three different needles, and all three
 * missed: `'already connected'`, `'session already connected'`, and
 * `'localhost is already trying to connect'` -- the last a string that existed
 * nowhere in the stack except the line testing for it.
 *
 * The consequence is not a wrong message, it is a wrong OUTCOME. Nothing emitted
 * `session-already-connected`, so nothing claimed the live session; the
 * auto-reconnect path fell through to exponential backoff, exhausted it, and
 * broadcast `isConnected: false` while a good session existed.
 *
 * A message in Rust and a predicate in TypeScript, in two repositories, with
 * nothing between them. So: extract the message, run it through the real
 * predicate, and require a match.
 *
 * Sibling of check-already-registered-predicate-matches-the-agent.mjs, which
 * does the same for PeerRegisterFailure. Both exist because this stack couples
 * behaviour to prose across a language boundary in more than one place.
 */
import { readFileSync, existsSync } from 'node:fs';

const RUST = 'citadel-internal-service/citadel-internal-service/src/kernel/requests/connect.rs';
const PREDICATE = 'citadel-workspaces/src/lib/connection/is-connect-in-progress.ts';

for (const f of [RUST, PREDICATE]) {
  if (!existsSync(f)) {
    console.error(`\n  ${f} does not exist. This gate connects two files; fix the path rather than deleting the check.\n`);
    process.exit(1);
  }
}

const rust = readFileSync(RUST, 'utf8');
const m = rust.match(/message:\s*format!\("([^"]*already in progress[^"]*)"/);
if (!m) {
  console.error(
    `\n  No duplicate-connect refusal found in ${RUST}.\n\n` +
    `  Expected a ConnectFailure whose message says a connection is already in\n` +
    `  progress. If the agent stopped sending one, this gate has nothing to\n` +
    `  guard and should be removed deliberately -- not left passing over nothing.\n`,
  );
  process.exit(1);
}
const message = m[1].replace(/\{[^}]*\}/g, 'bob');

// The predicate is dependency-free TypeScript; strip the annotations rather
// than pulling in a transpiler for one function.
const src = readFileSync(PREDICATE, 'utf8')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/export /g, '')
  .replace(/\(message: string \| undefined\): boolean/, '(message)')
  .replace(/const m: string =/, 'const m =');
const { isConnectAlreadyInProgress } = await import(
  `data:text/javascript,${encodeURIComponent(src + '\nexport { isConnectAlreadyInProgress };')}`
);

if (!isConnectAlreadyInProgress(message)) {
  console.error(
    `\n  The agent's duplicate-connect refusal is not recognised by the UI:\n\n` +
    `    agent sends : ${message}\n` +
    `    predicate   : ${PREDICATE}\n\n` +
    `  So nothing emits session-already-connected, nothing claims the live\n` +
    `  session, and auto-reconnect exhausts its backoff and reports disconnected\n` +
    `  while a good session exists.\n`,
  );
  process.exit(1);
}

// A predicate that returns true for everything would also pass the above.
if (isConnectAlreadyInProgress('Invalid username or password')) {
  console.error(
    `\n  The predicate matches "Invalid username or password" too, so it is not\n` +
    `  discriminating -- it would route a wrong password into the\n` +
    `  already-connected path. Narrow it.\n`,
  );
  process.exit(1);
}

console.log(`connect-in-progress predicate matches the agent: "${message}"`);
