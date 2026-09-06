#!/usr/bin/env node
/**
 * The failure-time log capture must be able to match every P2P log line the
 * agent emits.
 *
 * When a test fails, CI greps the agent's log for the P2P causal chain. That
 * grep is a hand-written alternation, and it had drifted from the code it reads:
 *
 *     \[P2P-MSG\]|\[PeerChannelCreated\]|\[P2P-RECV-CHANNEL\]|\[UDP-NEGOTIATION\]|…
 *
 * The agent emits `[PeerRegister]` from 21 sites and `[PeerConnect]` from 15,
 * and neither was in that list. So when six P2P specs failed on *registration*,
 * the capture returned the message-send phase in full and **nothing at all**
 * about the phase that was failing. `[P2P-RECV]` and `[P2P-RECV-CONNECT]` were
 * missing for the same reason — the literal `\[P2P-RECV-CHANNEL\]` matches
 * neither.
 *
 * This is the second defect class this repository produces: a hand-maintained
 * list inside a check, drifted from its source, reporting success. The first was
 * a gate naming a response variant that does not exist.
 *
 * So the prefixes are DERIVED from the agent's kernel sources and every one must
 * be matchable by the workflow's pattern. Both workflows are read: the parent's
 * and the UI submodule's, because a capture fixed in one and not the other is
 * the OTHER defect class, and it has happened three times this session.
 *
 * Deliberately NOT checked: that the pattern matches *only* those prefixes.
 * Over-capture costs log lines; under-capture costs the diagnosis.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = join(ROOT, 'citadel-internal-service', 'citadel-internal-service', 'src', 'kernel');
const WORKFLOWS = [
  join(ROOT, '.github/workflows/validate.yml'),
  join(ROOT, 'citadel-workspaces/.github/workflows/validate.yml'),
];

/** Bracketed prefixes on the peer / P2P paths, as the agent actually logs them. */
const PREFIX = /\[(P2P-[A-Z-]+|Peer[A-Za-z]+|PostRegister|UDP-NEGOTIATION)\]/g;

if (!existsSync(KERNEL)) {
  console.error(
    `FAIL: ${relative(ROOT, KERNEL)} is not present, so no prefixes could be derived.\n` +
      'Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

function* rustFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { yield* rustFiles(full); continue; }
    if (entry.endsWith('.rs')) yield full;
  }
}

const emitted = new Set();
for (const file of rustFiles(KERNEL)) {
  for (const m of readFileSync(file, 'utf8').matchAll(PREFIX)) emitted.add(m[1]);
}

// Vacuity floor: these prefixes exist in quantity. A small set means the logging
// was reshaped and every "covered" answer below is over nothing.
if (emitted.size < 5) {
  console.error(
    `FAIL: derived only ${emitted.size} P2P log prefix(es) from the agent kernel; there are\n` +
      'more than that. The logging shape changed — fix the derivation rather than letting\n' +
      'this compare against a set it made up.',
  );
  process.exit(1);
}

const problems = [];
let capturesFound = 0;

for (const path of WORKFLOWS) {
  if (!existsSync(path)) {
    console.error(
      `FAIL: ${path} is missing.\n` +
        'Run from the parent checkout with submodules initialised. A capture fixed in one\n' +
        'workflow and not the other is exactly how this class of defect survives.',
    );
    process.exit(1);
  }
  const label = relative(ROOT, path);
  const text = readFileSync(path, 'utf8');

  // The alternation inside the failure-time `grep -E "…"` over the agent log.
  for (const line of text.split('\n')) {
    if (!/grep\s+-E\s+"/.test(line)) continue;
    if (!/P2P|Peer/.test(line)) continue;
    capturesFound += 1;
    const pattern = line.match(/grep\s+-E\s+"([^"]*)"/)?.[1];
    if (!pattern) continue;
    // Does this alternation match the bracketed prefix as it appears in a log?
    let regex;
    try {
      regex = new RegExp(pattern);
    } catch {
      problems.push(`${label}: the capture pattern is not a valid regex: ${pattern}`);
      continue;
    }
    for (const prefix of [...emitted].sort()) {
      if (!regex.test(`[${prefix}]`)) {
        problems.push(`${label}: the failure capture cannot match \`[${prefix}]\`, which the agent logs`);
      }
    }
  }
}

// Second vacuity floor: both workflows carry such a capture.
if (capturesFound < 2) {
  console.error(
    `FAIL: found ${capturesFound} P2P log capture(s) across the two workflows; both have one.\n` +
      'The step changed shape — fix the match rather than leaving this reporting over nothing.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} P2P log prefix(es) the failure capture would drop.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nWhen a test fails, that grep is the only view of what the agent did. A prefix missing\n' +
      'from it is not merely absent from the log — it makes the failing phase invisible while\n' +
      'the log still looks full.\n' +
      '\nSix P2P specs failed on REGISTRATION while the capture matched only the message-send\n' +
      'phase, because `[PeerRegister]` (21 call sites) was not in the alternation.',
  );
  process.exit(1);
}

console.log(
  `check-failure-capture-covers-the-p2p-log: ${emitted.size} prefix(es) derived from the agent ` +
    `kernel; all matchable by ${capturesFound} capture(s) across 2 workflow(s).`,
);
