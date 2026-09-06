/**
 * Two Cargo workspaces that build halves of one running system must pin every
 * shared git dependency to the same revision.
 *
 * The server (this workspace) and the agent (citadel-internal-service/) speak
 * the Citadel protocol to each other. They are separate cargo workspaces with
 * separate lockfiles, and nothing made them agree -- so `cargo update` in one
 * moved that half of the system forward and left the other behind.
 *
 * When this gate was written they had drifted NINE SDK commits apart, and the
 * commits the agent was missing were:
 *
 *   d4b3eda1  do not answer BEGIN_CONNECT before this side's hole punch resolved
 *   b13d0d71  a refused request must reach the caller, not park them forever
 *   43003230  a C2S disconnect can no longer wait for ever
 *   aa1d6957  bind a packet's header CID to the session that authenticated
 *   52490c0f  preserve the errno on bind/connect, bound three unbounded receives
 *
 * That is a P2P connect failure, two hangs and a session-binding fix -- which is
 * an exact description of the symptoms this repository had been attributing to
 * flake. CLAUDE.md already names "rekey timeouts, P2P connection hangs,
 * protocol errors" as what a stale SDK looks like. Nothing checked.
 *
 * A version skew between two halves of one protocol is invisible in every log:
 * each side reports a successful build of a valid dependency. Only comparing
 * the two lockfiles shows it, and that is a comparison no human does routinely.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The lockfiles for the halves of the system that talk to each other. */
const LOCKFILES = [
  { label: 'server (parent workspace)', path: 'Cargo.lock' },
  { label: 'agent (citadel-internal-service)', path: 'citadel-internal-service/Cargo.lock' },
];

/**
 * Every `git+`-sourced package in a lockfile, as name -> {url, rev}.
 *
 * Only git dependencies are compared. Two workspaces resolving a crates.io
 * dependency to different patch versions is ordinary and usually harmless; two
 * workspaces resolving the same *protocol implementation* to different commits
 * is the defect this exists for.
 */
function gitPackages(text) {
  const found = new Map();
  // A lockfile package block is `name = ...` / `version = ...` / `source = ...`
  // in that order. Parse pairwise rather than with one regex over the file, so
  // a package without a source cannot borrow the next package's.
  const blocks = text.split(/\n\[\[package\]\]\n/).slice(1);
  for (const block of blocks) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const source = block.match(/^source = "(git\+[^"]+)"/m)?.[1];
    if (!name || !source) continue;
    const hash = source.lastIndexOf('#');
    if (hash === -1) continue;
    found.set(name, { url: source.slice(0, hash), rev: source.slice(hash + 1) });
  }
  return found;
}

const present = LOCKFILES.filter((l) => existsSync(join(ROOT, l.path)));
if (present.length < 2) {
  // A submodule that is not checked out cannot be compared. Say so rather than
  // passing silently: a gate that reports success on an empty comparison is the
  // failure mode this repository keeps finding.
  const missing = LOCKFILES.filter((l) => !existsSync(join(ROOT, l.path)));
  console.error(
    `SKIP: cannot compare git dependencies — ${missing.map((m) => m.path).join(', ')} ` +
      `not present. Run \`git submodule update --init --recursive\` first.`,
  );
  process.exit(1);
}

const parsed = present.map((l) => ({ ...l, packages: gitPackages(readFileSync(join(ROOT, l.path), 'utf8')) }));

/** Names that appear in more than one lockfile — the only ones worth comparing. */
const shared = new Set();
for (const a of parsed) {
  for (const name of a.packages.keys()) {
    if (parsed.filter((b) => b.packages.has(name)).length > 1) shared.add(name);
  }
}

const problems = [];
for (const name of [...shared].sort()) {
  const pins = parsed.filter((p) => p.packages.has(name)).map((p) => ({ label: p.label, path: p.path, ...p.packages.get(name) }));
  const revs = new Set(pins.map((p) => p.rev));
  if (revs.size === 1) continue;
  problems.push(
    `${name} is pinned to ${revs.size} different revisions:\n` +
      pins.map((p) => `    ${p.rev.slice(0, 8)}  ${p.path}  (${p.label})`).join('\n'),
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=Cargo.lock::${p.split('\n')[0]}`);
  console.error(`\nFAIL: ${problems.length} shared git dependenc(y|ies) disagree across lockfiles.\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(
    'These workspaces build two halves of ONE running system and speak a\n' +
      'versioned protocol to each other. A skew is invisible in the logs — each\n' +
      'side builds a valid dependency successfully — and surfaces as P2P hangs,\n' +
      'rekey timeouts and "flake".\n\n' +
      'Align them: `cargo update -p <name> --precise <rev>` in the workspace that\n' +
      'is behind, then rebuild BOTH images (see CLAUDE.md, "Updating citadel-sdk\n' +
      'Dependencies" — a restart is not enough, the binaries are baked in).',
  );
  process.exit(1);
}

console.log(
  `check-git-deps-agree-across-lockfiles: ${shared.size} shared git dependenc(y|ies) ` +
    `agree across ${parsed.length} lockfiles.`,
);
