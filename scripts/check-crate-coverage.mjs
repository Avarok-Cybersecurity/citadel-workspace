#!/usr/bin/env node
/**
 * Fails if a Cargo workspace member has no cargo-fmt, cargo-clippy or test job.
 *
 * A gate that exists but does not run against a path is indistinguishable from
 * a gate that passes. `intersession-layer-messaging` is a member of
 * citadel-internal-service's workspace and was named by NEITHER matrix, so a
 * committed file sat there failing `cargo fmt --check` while every CI run was
 * green. Nobody had removed a check; the check simply never looked.
 *
 * All three kinds are checked, not just linting: the citadel-internal-service
 * workspace once had lint jobs and no test job at all, so fmt and clippy ran
 * over eight crates whose tests ran nowhere. This header said "fmt / clippy"
 * for long enough that a later reader went looking for the test gap it already
 * covers.
 *
 * This compares the two `[workspace] members` lists against the matrices in
 * validate.yml. Deliberate exclusions belong in EXCLUDED below, WITH a reason,
 * so that skipping a crate is a decision someone wrote down rather than a gap
 * nobody noticed.
 *
 * Pure file reads: no cargo, no network, no toolchain. `cargo metadata` would
 * be the obvious way to enumerate members and is deliberately avoided — it
 * resolves this repo's git dependencies on Citadel-Protocol, which needs the
 * network and would make this gate fail for reasons unrelated to its job.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['Cargo.toml', 'citadel-internal-service/Cargo.toml'];
const WORKFLOW = '.github/workflows/validate.yml';

/** Exclusions must carry a reason. An empty string is treated as no reason. */
const EXCLUDED = {
  'citadel-workspace-server-kernel/tests/common':
    'test-support crate, compiled only as a dev-dependency of its parent',
  'citadel-internal-service/tests/common':
    'test-support crate, compiled only as a dev-dependency of its parent',
};

const failures = [];
const fail = (msg) => failures.push(msg);

/** Crate name declared by a member directory, or null if it has no manifest. */
function packageName(memberDir) {
  const manifest = join(ROOT, memberDir, 'Cargo.toml');
  if (!existsSync(manifest)) return null;
  const m = readFileSync(manifest, 'utf8').match(/^\s*name\s*=\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

/** The `members = [...]` entries of one workspace manifest. */
function members(manifestPath) {
  const text = readFileSync(join(ROOT, manifestPath), 'utf8');
  const block = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  const base = dirname(manifestPath) === '.' ? '' : dirname(manifestPath);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => ({
    dir: base ? join(base, m[1]) : m[1],
    declared: m[1],
    workspace: manifestPath,
  }));
}

/** Crate names listed under a job's matrix in the workflow. */
function matrixCrates(workflow, jobName) {
  const job = workflow.split(`\n  ${jobName}:`)[1];
  if (job === undefined) {
    fail(`validate.yml has no job named "${jobName}" — this checker is looking for a job that no longer exists, which would make it pass vacuously.`);
    return null;
  }
  const scope = job.split(/\n  \w[\w-]*:/)[0];
  const names = new Set();
  for (const m of scope.matchAll(/-\s+crate:\s*([\w-]+)/g)) names.add(m[1]);
  for (const m of scope.matchAll(/^\s+-\s+([a-z][\w-]+)\s*$/gm)) names.add(m[1]);
  return names;
}

const workflow = readFileSync(join(ROOT, WORKFLOW), 'utf8');
const all = WORKSPACES.flatMap(members);

// Anti-vacuity: if parsing silently stops matching, say so loudly rather than
// reporting a clean run. This checker failing to find anything is the same
// class of bug it exists to catch.
if (all.length < 8) {
  fail(`Only ${all.length} workspace member(s) parsed from ${WORKSPACES.join(', ')}; expected at least 8. The manifests changed shape and this checker is no longer reading them.`);
}

/**
 * Workspace directories covered wholesale, i.e. by `cargo fmt --all` or
 * `cargo clippy --workspace` rather than by a crate list.
 *
 * Wholesale coverage is strictly better than enumeration here: a list has to be
 * edited every time a crate is added, and the edit that never happens is
 * invisible. A workspace-wide job covers crates that do not exist yet.
 */
function wholesaleDirs(kind) {
  const dirs = new Set();
  const jobs = workflow.split(/\n  (?=[a-z][\w-]*:)/);
  // A job covering a whole workspace at once, rather than crate by crate.
  const WHOLESALE = {
    fmt: /cargo fmt\s+--all/,
    clippy: /cargo clippy\s+--workspace/,
    test: /cargo (?:nextest run|test)\s+--workspace/,
  };
  const wanted = WHOLESALE[kind];
  for (const job of jobs) {
    if (!wanted.test(job)) continue;
    // Steps that set no working-directory operate on the repo root.
    const wds = [...job.matchAll(/working-directory:\s*(\S+)/g)].map((m) => m[1]);
    if (wds.length === 0) dirs.add('.');
    for (const wd of wds) dirs.add(wd.replace(/\/$/, ''));
  }
  return dirs;
}

// `test` included because the citadel-internal-service workspace had a lint job
// and no test job at all: fmt and clippy ran on eight crates whose tests ran
// nowhere. A guard that only checks linting cannot report that, and the gap was
// found by audit rather than by CI.
for (const job of ['fmt', 'clippy', 'test']) {
  // The per-crate matrix job's name in the workflow, which is not the kind.
  const JOB_NAMES = { fmt: 'fmt', clippy: 'clippy', test: 'rust-tests' };
  const covered = matrixCrates(workflow, JOB_NAMES[job]);
  if (!covered) continue;
  const wholesale = wholesaleDirs(job);
  if (covered.size < 3) {
    fail(`The "${job}" matrix parsed as ${covered.size} crate(s); expected at least 3. The matrix changed shape and this checker is no longer reading it.`);
    continue;
  }
  for (const member of all) {
    const reason = EXCLUDED[member.declared];
    if (reason) continue;
    const wsDir = dirname(member.workspace) === '.' ? '.' : dirname(member.workspace);
    if (wholesale.has(wsDir)) continue;
    const name = packageName(member.dir);
    if (!name) {
      fail(`${member.workspace} lists member "${member.declared}" but ${member.dir}/Cargo.toml does not exist — the members list names a crate that is not there.`);
      continue;
    }
    if (!covered.has(name)) {
      fail(
        `Crate "${name}" (${member.dir}, from ${member.workspace}) has no "${job}" job.\n` +
        `    A gate that never runs against a path cannot fail, so this crate's ${job} status is unknown, not clean.\n` +
        `    Fix: add it to the ${job} matrix in ${WORKFLOW} (crates outside the root workspace need a working-directory),\n` +
        `    or add "${member.declared}" to EXCLUDED in ${'scripts/check-crate-coverage.mjs'} with the reason.`,
      );
    }
  }
}

for (const [dir, reason] of Object.entries(EXCLUDED)) {
  if (!reason.trim()) fail(`EXCLUDED entry "${dir}" has no reason. An exclusion without a justification is a silent gap.`);
}

if (failures.length) {
  console.error(`\nCrate coverage: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`Crate coverage: all ${all.length - Object.keys(EXCLUDED).length} workspace crates are covered by cargo fmt, clippy and tests.`);
