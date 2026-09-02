#!/usr/bin/env node
// An image that compiles this workspace must copy the lockfile.
//
// `citadel_sdk` is a git dependency on `branch = "master"` (Cargo.toml). Without
// Cargo.lock in the build context, cargo re-resolves it to master's TIP when the
// image is built — so the same workspace commit built twice can produce two
// different binaries, and a change merged to the protocol repository reaches
// these containers with no change here and no signal anywhere.
//
// That is not hypothetical. Two CI runs of one unchanged branch, four hours
// apart, built different protocol revisions; the second one turned an
// integration test red, and the regression was in code that had been merged to
// the other repository in between. Nothing in this repo could have shown it.
//
// The gate is the copy, not the flag: `--locked` would also be correct, but the
// server image builds from an alternate manifest and may legitimately need to
// resolve deps the root lock does not carry. Copying the lock is what pins the
// git revision either way.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// A COPY that names a file the build context excludes is not a copy.
//
// The first version of this gate checked only the Dockerfile text, and passed
// while `.dockerignore` carried `Cargo.lock` — so both images failed to build
// with `"/Cargo.lock": not found`. The gate was reading an intention, not a
// capability, which is the same defect it exists to prevent one level down.
//
// The ignore entry was there on purpose, with the rationale "let Docker resolve
// its own deps to avoid stale git revision hashes" — the failure mode in the
// language of a fix.
function lockfileReachesTheBuildContext() {
  if (!existsSync('.dockerignore')) return { ok: true };
  const patterns = readFileSync('.dockerignore', 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  const offending = patterns.filter((p) => /(^|\/|\*)Cargo\.lock$/.test(p));
  return { ok: offending.length === 0, offending };
}

const MANIFEST = /^COPY\s+\S*Cargo(\.docker)?\.toml\s/m;
const LOCK = /^COPY\s+\S*Cargo\.lock\s/m;

let files;
try {
  files = execSync("find docker -name 'Dockerfile*'", { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
} catch {
  console.error('FAIL: cannot scan docker/.');
  process.exit(1);
}

const reach = lockfileReachesTheBuildContext();
if (!reach.ok) {
  console.error(`::error file=.dockerignore::excludes the lockfile: ${reach.offending.join(', ')}`);
  console.error('\nFAIL: .dockerignore excludes Cargo.lock, so the COPY in each Dockerfile');
  console.error('cannot find it and the build fails with \'"/Cargo.lock": not found\'.');
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // Only images that actually build the Rust workspace.
  if (!MANIFEST.test(text) || !/cargo\s+build/.test(text)) continue;
  checked++;
  if (!LOCK.test(text)) problems.push(file);
}

if (!checked) {
  console.error('FAIL: found no Dockerfile that builds the cargo workspace — the pattern has gone stale.');
  console.error('A gate that matches nothing reports a safety it never measured.');
  process.exit(1);
}

for (const file of problems) {
  console.error(`::error file=${file}::${file} compiles the workspace without copying Cargo.lock`);
}

if (problems.length) {
  console.error(`\nFAIL: ${problems.length} of ${checked} image(s) build the workspace without the lockfile.`);
  console.error('Add `COPY ./Cargo.lock /usr/src/app/Cargo.lock`. Without it the git dependency on');
  console.error('branch = "master" resolves to whatever that branch happens to be at build time.');
  process.exit(1);
}
console.log(`OK: all ${checked} workspace-building image(s) copy the lockfile, and the build context carries it.`);
