#!/usr/bin/env node
/**
 * Every CI gate that can run without Docker, in one command -- and the tiers the hooks run.
 *
 *   node scripts/preflight.mjs                     everything (what CI's Docker-free jobs run)
 *   node scripts/preflight.mjs --tier pre-commit   staged paths only; the pre-commit hook
 *   node scripts/preflight.mjs --tier pre-push     what the pushed commits changed; the pre-push hook
 *   node scripts/preflight.mjs --print-plan        the full plan as JSON, run nothing
 *   node scripts/preflight.mjs --tier … --dry-run   what this hook would run or skip as stamped, as JSON
 *
 * Pass stamps (lib/preflight-stamp.mjs): a check that already passed on this box over
 * byte-identical inputs prints `ok (stamped: …)` and is not re-run. Every check is stamped but the
 * checkout and remote checks. Never on `--tier full` or with PREFLIGHT_NO_STAMP=1; `--stamp-dir
 * <dir>` names another store. Anything beyond the node gates waits for the machine-wide hook lock.
 *
 * pre-push takes `--remote <name>` and the refs on stdin, exactly as git hands them over, and only
 * VERIFIES stamps (lib/preflight-push.mjs) unless `node scripts/pre-push-tier.mjs` runs it.
 * The hooks have one escape hatch, `git commit/push --no-verify`, and no silent one.
 *
 * Thirty days of CI held 344 root-cause failures; ~190 were gates this file already ran, that
 * nobody ran before pushing. Hence the hooks. The rest of this file's history, briefly:
 *
 *  - The gate list is DERIVED from validate.yml (lib/preflight-plan.mjs). A hand-kept list drifted
 *    to ten gates while CI ran twenty-one. (The UI repo's workflow was read too, until the UI was
 *    folded into citadel-workspaces/ and its gates into validate.yml.)
 *  - Arguments are part of a gate: `build-gates-index.mjs` without `--check` WRITES docs/GATES.md.
 *  - The checkout is checked first and alone (ENVIRONMENT): on an uninitialised tree, 80 true
 *    failures used to bury the one that named the cause a thousand lines down.
 *  - The submodule-pointer guard is here because an unpushed submodule commit kills every CI job
 *    at checkout, before it reports anything about the code.
 *  - Cargo gates are hand-listed (the derivation reads node and npm gates only), behind a cargo
 *    guard so a frontend-only checkout skips them by name instead of failing over an empty block.
 *  - SKIP_WASM_BUILD is set for every check: a plain `cargo clippy` otherwise rebuilds the WASM
 *    client and overwrites the committed artifacts the UI imports (lib/preflight-run.mjs).
 *  - `rust wasm target compiles`: a cfg slip in ILM built on native, passed 71 tests and clippy,
 *    and could not build for wasm32 at all. `cargo check` on the wasm CLIENT crate, not ILM
 *    (uuid's randomness feature comes from the client), and a check, not a wasm-pack build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoWorkspaceChecks, derivedHookChecks, uiTestReadsIn } from './lib/preflight-derived.mjs';
import { prerequisiteProblem } from './lib/prerequisites.mjs';
import { crateOf, selectChecks } from './lib/change-tiers.mjs';
import { pushedPaths, stagedPaths } from './lib/changed-paths.mjs';
import { printFailures, runChecks, runFatal } from './lib/preflight-run.mjs';
import { STAMP_DIR, distStaleness, planStamps, recordPasses } from './lib/preflight-stamp-io.mjs';
import { stampedLine } from './lib/preflight-stamp.mjs';
import { noRefsMessage, pushMode } from './lib/preflight-push.mjs';
import { judgePush } from './lib/preflight-push-io.mjs';
import { acquire, logTimes } from './lib/hook-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'citadel-workspaces');
const IS = join(ROOT, 'citadel-internal-service');

function option(name, allowed) {
  const at = process.argv.indexOf(name);
  if (at < 0) return null;
  const value = process.argv[at + 1];
  if (!allowed.includes(value)) {
    console.error(`preflight: ${name} takes one of ${allowed.join(', ')}; got '${value ?? ''}'.`);
    process.exit(2);
  }
  return value;
}
const tier = option('--tier', ['full', 'pre-commit', 'pre-push']) ?? 'full';
const stampDirAt = process.argv.indexOf('--stamp-dir');
if (stampDirAt >= 0 && !process.argv[stampDirAt + 1]) {
  console.error('preflight: --stamp-dir takes a directory.');
  process.exit(2);
}
const stampDir = stampDirAt >= 0 ? process.argv[stampDirAt + 1] : STAMP_DIR;
const remote = tier === 'pre-push' ? (process.argv[process.argv.indexOf('--remote') + 1] ?? null) : null;
if (tier === 'pre-push' && (process.argv.indexOf('--remote') < 0 || !remote)) {
  console.error('preflight: --tier pre-push needs --remote <name> (the hook passes "$1").');
  process.exit(2);
}

const tag = (...tiers) => new Set(tiers);
const check = (name, cmd, args, cwd, tiers) => ({ name, cmd, args, cwd, env: {}, tiers });

/** The checkout itself, first and fatal: every other check reads it. */
const ENVIRONMENT = [
  check('submodules are populated', 'node', ['scripts/check-submodules-are-populated.mjs'], ROOT, tag('env')),
  check('hooks are installed', 'node', ['scripts/check-hooks-are-installed.mjs'], ROOT, tag('env')),
  check('node matches CI', 'node', ['scripts/check-node-matches-ci.mjs'], ROOT, tag('env')),
  check('node_modules matches the lockfile', 'node', ['scripts/check-modules-match-lockfile.mjs'], ROOT, tag('env')),
  check('UI is not a nested repo', 'node', ['scripts/check-ui-is-not-a-nested-repo.mjs'], ROOT, tag('env')),
];

let plan;
try {
  plan = derivedHookChecks(ROOT);
} catch (error) {
  console.error(`preflight: ${error.message}`);
  process.exit(1);
}
const skipped = [...plan.skipped];
const derived = plan.checks;

const haveCargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const ROOT_CRATES = /members\s*=\s*\[([^\]]*)\]/.exec(readFileSync(join(ROOT, 'Cargo.toml'), 'utf8'))[1]
  .split(',').map((m) => m.trim().replace(/^"|"$/g, '')).filter(Boolean);

const cargo = [];
if (haveCargo) {
  cargo.push(check('rust wasm target compiles', 'cargo',
    ['check', '-p', 'citadel-internal-service-wasm-client', '--target', 'wasm32-unknown-unknown'], IS, tag('rust:agent')));
  for (const [label, cwd, tierName] of [['rust workspace', ROOT, 'rust:root'], ['rust internal-service workspace', IS, 'rust:agent']]) {
    cargo.push(
      check(`${label} fmt`, 'cargo', ['fmt', '--all', '--check'], cwd, tag(tierName)),
      check(`${label} clippy`, 'cargo', ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'], cwd, tag(tierName)),
      check(`${label} tests`, 'cargo', ['test', '--workspace'], cwd, tag(tierName)),
    );
  }
  cargo.push(...cargoWorkspaceChecks(ROOT, [ROOT, IS].map((d) => relative(ROOT, d) || '.')));
} else {
  skipped.push(['rust wasm target compiles, fmt, clippy, tests', 'cargo is not on PATH']);
}

let mode = null;
try {
  mode = tier === 'pre-push' ? pushMode(process.env.PREFLIGHT_PRE_PUSH) : null;
} catch (error) {
  console.error(`preflight: ${error.message}`);
  process.exit(2);
}
/** Paths this hook judges, and for pre-push the refs git handed it. */
function changed() {
  if (tier === 'pre-commit') return { paths: stagedPaths(ROOT, ''), refs: [] };
  if (tier === 'pre-push') return pushedPaths(ROOT, '', remote, readFileSync(0, 'utf8'));
  return { paths: [], refs: [] };
}
const { paths, refs } = changed();
// Git feeds refs to a hook; with none and no git around us, this is a hand run that would judge nothing.
if (tier === 'pre-push' && refs.length === 0 && process.env.GIT_EXEC_PATH === undefined) {
  console.error(noRefsMessage());
  process.exit(2);
}

/** Checks whose arguments ARE the staged files. */
function preCommitOnly() {
  if (tier !== 'pre-commit') return [];
  const out = [];
  const lintable = paths.filter((p) => p.startsWith('citadel-workspaces/') && /\.(ts|tsx|js|jsx|mjs)$/.test(p))
    .map((p) => p.slice('citadel-workspaces/'.length));
  if (lintable.length > 0) out.push(check(`eslint (${lintable.length} staged)`, 'npx', ['eslint', '--max-warnings', '0', '--no-warn-ignored', ...lintable], UI, tag('pre-commit-only')));
  if (haveCargo) {
    for (const crate of new Set(paths.filter((p) => p.endsWith('.rs')).map((p) => crateOf(p, ROOT_CRATES)).filter(Boolean))) {
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, crate, 'Cargo.toml'), 'utf8'))[1];
      out.push(check(`cargo fmt ${name}`, 'cargo', ['fmt', '-p', name, '--check'], ROOT, tag('pre-commit-only')));
    }
  }
  return out;
}

const CHECKS = [
  ...derived,
  // Not in validate.yml: by the time CI runs, checkout has already succeeded or died.
  check('submodule pointers pushed', 'node', ['scripts/check-submodule-pointers-pushed.mjs'], ROOT, tag('push')),
  // Before the TypeScript checks: without these artefacts they fail as if the source were broken.
  check('generated artefacts present', 'node', ['scripts/check-generated-artefacts-present.mjs'], ROOT, tag('ui', 'rust:agent')),
  // ts-rs drops imports named inside `#[ts(type = "...")]`; CI type-checks the bindings alone.
  check('generated bindings typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], join(IS, 'typescript-client'), tag('ui', 'rust:agent')),
  check('typecheck', 'npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], UI, tag('ui')),
  check('eslint', 'npx', ['eslint', '.', '--max-warnings', '0'], UI, tag('ui')),
  { ...check('unit tests', 'npx', ['vitest', 'run'], UI, tag('ui')), reads: uiTestReadsIn(ROOT) },
  ...preCommitOnly(),
  ...cargo,
];

if (process.argv.includes('--print-plan')) {
  // writeFileSync to fd 1: process.exit after console.log truncates a piped write at 8 KB.
  writeFileSync(1, `${JSON.stringify(CHECKS.map(({ name, cmd, args, cwd }) => ({ name, cmd, args, cwd })))}\n`);
  process.exit(0);
}

const started = Date.now();
const selected = selectChecks(CHECKS, tier, paths, ROOT_CRATES);
function planOrDie() {
  try {
    return planStamps({ root: ROOT, checks: selected, tier, env: process.env, dir: stampDir, now: started });
  } catch (error) {
    console.error(`preflight: pass stamps: ${error.message}\n  (an error is never a stamp match; PREFLIGHT_NO_STAMP=1 runs without stamps)`);
    process.exit(1);
  }
}
const noteOf = (stamps) => (stamps.off ? `stamps not consulted: ${stamps.off}` : `stamps: ${stampDir}`);
if (process.argv.includes('--dry-run')) {
  const stamps = planOrDie();
  const rows = stamps.plan.map(({ check: c, key, decision: d }) => ({ name: c.name, run: d.run, key,
    why: d.run ? d.why : stampedLine(d.record, started), ms: d.run ? null : d.record.ms }));
  writeFileSync(1, `${JSON.stringify({ hook: tier, paths, note: noteOf(stamps), distWarning: stamps.browser ? distStaleness(ROOT) : null, rows })}\n`);
  process.exit(0);
}
console.log(`preflight --tier ${tier}${paths.length ? `: ${paths.length} changed path(s)` : ''}`);
await runFatal(ENVIRONMENT);
const stamps = planOrDie();
console.log(`  (${noteOf(stamps)})`);
if (tier === 'pre-push') judgePush({ root: ROOT, refs, mode, stamps, stampDir });
const stale = stamps.browser ? distStaleness(ROOT) : null;
if (stale) console.log(`  warning, separate from stamps: ${stale}`);
const toRun = [];
for (const { check: c, decision } of stamps.plan) {
  if (decision.run) toRun.push(c);
  if (decision.run && decision.warn) console.log(`  ${c.name}: re-running, ${decision.why}`);
  if (!decision.run) console.log(`  ${c.name} … ${stampedLine(decision.record, started)}`);
}
const prerequisite = prerequisiteProblem({ checks: toRun.map((c) => ({ ...c, cwd: resolve(ROOT, c.cwd) })), uiDirs: [UI, join(ROOT, 'citadel-workspace-client-ts')], exists: (p) => existsSync(join(ROOT, p)) });
if (prerequisite !== null) { console.error(`preflight: ${prerequisite}`); process.exit(1); }
const keyOf = new Map(stamps.plan.filter((p) => p.key).map((p) => [p.check, p.key]));
const passes = [];
// Anything beyond the node gates (cargo, tsc, vitest, a browser) waits for the machine-wide lock, and
// for CITADEL_HOOK_LOCK_HONOUR's lock directory when it is set (a stop-gap lock some lanes still use).
const heavy = toRun.some((c) => c.cmd !== 'node');
const lock = join(dirname(stampDir), 'hook.lock');
const what = `preflight --tier ${tier}${mode ? ` (${mode})` : ''} in ${ROOT}`;
const release = heavy ? await acquire({ lock, what, say: (line) => console.log(`  ${line}`), waitMs: 5000, deadline: Infinity, honour: process.env.CITADEL_HOOK_LOCK_HONOUR ?? null }) : null;
const ranFrom = Date.now();
const failed = await runChecks(toRun, (c, ms) => { if (keyOf.has(c)) passes.push({ key: keyOf.get(c), name: c.name, ms }); });
if (release) {
  logTimes(lock, { at: Date.now(), what: `${tier}${mode ? `/${mode}` : ''}`, root: ROOT, waitedMs: release.waitedMs, ranMs: Date.now() - ranFrom, status: failed.length ? `${failed.length} failed` : 'ok' });
  release();
}
if (stamps.world) console.log(`  (${recordPasses({ root: ROOT, env: process.env, dir: stampDir, world: stamps.world, hook: tier, passes, now: Date.now() })})`);
const total = selected.length + ENVIRONMENT.length;
const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;

if (failed.length > 0) {
  printFailures(failed, total);
  console.error(`(${took}; bypass for one commit or push, deliberately: --no-verify)`);
  process.exit(1);
}
for (const [name, reason] of skipped) console.log(`  ${name} … skipped here (${reason})`);
console.log(`\nAll ${total} checks passed in ${took}.`);
