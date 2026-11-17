#!/usr/bin/env node
/**
 * A Connect has three terminal answers. Anything awaiting one handles all three.
 *
 * `connect.rs` settles a Connect with exactly `ConnectSuccess`,
 * `ConnectFailure` or `SessionAlreadyActive`. An awaiter that matches only some
 * of them does not fail — it waits, to its own 30-second timeout, and then
 * reports the timeout as the cause. The user is told "Registration timed out"
 * for a registration that succeeded, retries, and is told the username already
 * exists for an account they did not know they owned.
 *
 * That has now happened twice in this one file. `registration-response-handler`
 * matched the `Response`-wrapped `ConnectFailure` and not the top-level one; the
 * fix added the top-level branch and left `SessionAlreadyActive` unhandled four
 * lines below the comment describing the failure. One rule, applied to one of
 * the variants it covers, is the defect class this repo produces most.
 *
 * So the set is DERIVED, from the Rust, and this fails if it cannot derive it —
 * a hand-written list here would be the same defect wearing a gate's clothes.
 *
 * Terminal answers are those bound to `let response = InternalServiceResponse::…`,
 * which is what `HandledRequestResult` carries back. `MessageNotification` is
 * bound to `message` and pumped from the session's read stream: it is an event
 * on the connection, not an answer to the request, and requiring awaiters to
 * handle it would be wrong.
 *
 * WHO must handle them is deliberately narrow: a file that names BOTH
 * `'ConnectSuccess'` and `'ConnectFailure'` as variant strings is settling a
 * Connect. A file naming one of them is routing, logging or testing, and
 * demanding the full set there would report over most of `src/lib`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECT_RS = resolve(
  UI, '..', 'citadel-internal-service', 'citadel-internal-service',
  'src', 'kernel', 'requests', 'connect.rs',
);

if (!existsSync(CONNECT_RS)) {
  console.error(
    'FAIL: cannot read the internal service\'s connect.rs, so the terminal answers\n' +
      `cannot be derived:\n  ${CONNECT_RS}\n\n` +
      'The citadel-internal-service submodule must be checked out. Run this from the\n' +
      'parent checkout (`npm run preflight`), not from a bare UI clone.',
  );
  process.exit(1);
}

/** Bound to `response`, so returned in a HandledRequestResult: an ANSWER. */
const TERMINAL = new Set(
  [...readFileSync(CONNECT_RS, 'utf8')
    .matchAll(/let\s+response\s*=\s*InternalServiceResponse::(\w+)/g)].map((m) => m[1]),
);

// Vacuity floor on the derivation itself. Success and failure are the two that
// have always been there; if the shape of connect.rs changed enough to lose
// them, every comparison below is against a set this gate invented.
for (const required of ['ConnectSuccess', 'ConnectFailure']) {
  if (!TERMINAL.has(required)) {
    console.error(
      `FAIL: derived only [${[...TERMINAL].join(', ')}] from connect.rs, which is missing\n` +
        `\`${required}\`. The binding shape changed — fix the derivation rather than\n` +
        'letting this compare against a set it made up.',
    );
    process.exit(1);
  }
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* sources(full); continue; }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield full;
  }
}

const offenders = [];
let awaiters = 0;

for (const file of sources(join(UI, 'src'))) {
  const text = readFileSync(file, 'utf8');
  // Settling a Connect means naming both outcomes. One alone is routing or logging.
  if (!text.includes("'ConnectSuccess'") || !text.includes("'ConnectFailure'")) continue;
  awaiters += 1;
  const missing = [...TERMINAL].filter((variant) => !text.includes(`'${variant}'`));
  if (missing.length > 0) {
    offenders.push(`${relative(UI, file)}: settles a Connect but never names ${missing.join(', ')}`);
  }
}

// Second vacuity floor: three files settle a Connect. Zero means the variant
// strings are spelled some other way now and this walked past all of them.
if (awaiters < 3) {
  console.error(
    `FAIL: only ${awaiters} file(s) look like they settle a Connect; at least three do\n` +
      '(the login handler, the registration handler and the auto-connect responses).\n' +
      'The variant strings are reached some other way now — fix the match, do not\n' +
      'leave this reporting over nothing.',
  );
  process.exit(1);
}

if (offenders.length > 0) {
  for (const o of offenders) console.error(`::error::${o}`);
  console.error(`\nFAIL: ${offenders.length} Connect awaiter(s) cannot settle on every answer.\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    `\nconnect.rs settles a Connect with exactly: ${[...TERMINAL].join(', ')}.\n` +
      '\nAn unhandled one does not fail — it waits out the 30s timeout and then reports\n' +
      'the timeout as the cause. A registration that SUCCEEDED is reported as timed out,\n' +
      'and the retry says the username already exists.\n' +
      '\nWith `connect_after_register` the service re-dispatches a real Connect under the\n' +
      'SAME request_id (register.rs), so the registration path sees all three too.',
  );
  process.exit(1);
}

console.log(
  `check-connect-awaiters-handle-every-answer: ${awaiters} awaiter(s); all name every one of ` +
    `the ${TERMINAL.size} terminal answers derived from connect.rs.`,
);
