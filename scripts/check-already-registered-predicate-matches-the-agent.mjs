#!/usr/bin/env node
/**
 * Exactly one `PeerRegisterFailure` message may be read as success.
 *
 * "Peer N is already registered" is a success wearing the Failure variant --
 * CIDs are permanent, so every reconnect re-registers and gets it back. Five
 * consumers act on that classification: the accept-matcher resolves and the
 * lifecycle proceeds to connect, the retry record is deleted, the discovery row
 * is marked, and `p2p:peer-registered` is emitted, which auto-connect turns
 * into `addOnlinePeer`.
 *
 * The agent also answers a FAILED peer-list read with
 *
 *   "Could not determine whether {peer} is already registered: {err}.
 *    Nothing was changed; try again."
 *
 * which is the opposite claim and contains the same phrase. The UI's substring
 * test read it as success, so a transient read error produced a peer shown
 * online and registered, a destroyed retry record, no registration, and silence.
 *
 * The two sides are a message written in Rust and a regex written in
 * TypeScript, in different repositories. Nothing but this connects them.
 *
 * So: extract every `PeerRegisterFailure` message format the agent can emit,
 * render each with placeholders filled, run it through the REAL predicate, and
 * assert exactly one is classified as success. A new ambiguous message fails
 * here, naming itself, instead of in a user's session as silence.
 */
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RUST = 'citadel-internal-service/citadel-internal-service/src/kernel/requests/peer/register.rs';
const PREDICATE = 'citadel-workspaces/src/lib/peer-registration-store/already-registered.ts';

for (const f of [RUST, PREDICATE]) {
  if (!existsSync(f)) {
    console.error(`\n  ${f} does not exist. This gate connects two files; if either moved,\n  fix the path -- do not delete the check.\n`);
    process.exit(1);
  }
}

// Every `message:` in a PeerRegisterFailure literal. Both spellings the file
// uses: a `format!(...)` and a plain string.
const rust = readFileSync(RUST, 'utf8');
const messages = [];
const failureBlocks = rust.split('PeerRegisterFailure {').slice(1);
for (const block of failureBlocks) {
  // NOT `slice(0, indexOf('}'))`: the first `}` sits inside the format string's
  // own `{}` placeholders, so that cut lands before `message:` and the
  // extraction finds nothing. The vacuity floor below caught exactly that.
  const body = block.slice(0, 800);
  const fmt = body.match(/message:\s*format!\(\s*((?:"[^"]*"\s*)+)/s);
  if (fmt) {
    // Concatenate the adjacent string literals of a multi-line format!.
    const joined = [...fmt[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
    messages.push(joined.replace(/\{[^}]*\}/g, '99').replace(/\\\s+/g, ''));
    continue;
  }
  const plain = body.match(/message:\s*"([^"]*)"/);
  if (plain) messages.push(plain[1]);
}

if (messages.length < 2) {
  console.error(
    `\n  Found only ${messages.length} PeerRegisterFailure message(s) in ${RUST}.\n\n` +
    `  This gate exists because two of them contain the same phrase and mean\n` +
    `  opposite things. Finding fewer than two means the extraction stopped\n` +
    `  matching and the check is asserting over nothing.\n`,
  );
  process.exit(1);
}

const { isAlreadyRegistered } = await import(pathToFileURL(PREDICATE).href).catch(async () => {
  // The predicate is TypeScript with no imports of its own; strip the types
  // rather than pulling in a transpiler for one function.
  const src = readFileSync(PREDICATE, 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/export /g, '')
    .replace(/:\s*readonly RegExp\[\]/g, '')
    .replace(/\(message: string \| undefined\): boolean/g, '(message)')
    .replace(/\(re: RegExp\)/g, '(re)');
  const mod = await import(`data:text/javascript,${encodeURIComponent(src + '\nexport { isAlreadyRegistered };')}`);
  return mod;
});

const classified = messages.map((m) => ({ message: m, success: isAlreadyRegistered(m) }));
const asSuccess = classified.filter((c) => c.success);

if (asSuccess.length !== 1) {
  console.error(
    `\n  ${asSuccess.length} of ${messages.length} PeerRegisterFailure messages are read as SUCCESS.\n` +
    `  Exactly one may be.\n\n` +
    classified.map((c) => `    ${c.success ? 'SUCCESS' : 'refusal'}  ${c.message}`).join('\n') +
    `\n\n  A message the agent sends to say it could NOT determine something must not\n` +
    `  be classified as having determined it. Five consumers act on that answer:\n` +
    `  they resolve, connect, delete the retry record, mark the row and emit\n` +
    `  p2p:peer-registered. Getting it wrong is silent in production.\n\n` +
    `  Fix the predicate in ${PREDICATE}, or reword the message.\n`,
  );
  process.exit(1);
}

console.log(
  `already-registered predicate: exactly 1 of ${messages.length} agent messages reads as success ` +
  `("${asSuccess[0].message.slice(0, 48)}...")`,
);
