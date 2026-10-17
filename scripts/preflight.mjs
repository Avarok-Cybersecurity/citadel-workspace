#!/usr/bin/env node
/**
 * Every CI gate that can run without Docker, in one command -- and the tiers the hooks run.
 *
 *   node scripts/preflight.mjs                     everything (what CI's Docker-free jobs run)
 *   node scripts/preflight.mjs --tier pre-commit   staged paths only; the pre-commit hook
 *   node scripts/preflight.mjs --tier pre-push     what the pushed commits changed; the pre-push hook
 *   node scripts/preflight.mjs --print-plan        the full plan as JSON, run nothing
 *
 * `--repo ui` says the hook runs in the UI submodule (its paths are prefixed citadel-workspaces/);
 * pre-push also takes `--remote <name>` and the refs on stdin, exactly as git hands them over.
 * The hooks have one escape hatch, `git commit/push --no-verify`, and no silent one.
 *
 * Thirty days of CI held 344 root-cause failures; ~190 were gates this file already ran, that
 * nobody ran before pushing. Hence the hooks. The rest of this file's history, briefly:
 *
 *  - The gate list is DERIVED from the workflows (lib/preflight-plan.mjs), now BOTH the parent's
 *    validate.yml and the UI repo's. A hand-kept list drifted to ten gates while CI ran twenty-one,
 *    and the UI's `npm run check:*` steps ran nowhere but UI CI.
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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_ON_PRE_COMMIT, derivedChecks, gateKey } from './lib/preflight-plan.mjs';
import { crateOf, readsWholeRepo, selectChecks } from './lib/change-tiers.mjs';
import { pushedPaths, stagedPaths } from './lib/changed-paths.mjs';
import { printFailures, runChecks, runFatal } from './lib/preflight-run.mjs';

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
const repo = option('--repo', ['parent', 'ui']) ?? 'parent';
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
];

let plan;
try {
  plan = derivedChecks(ROOT);
} catch (error) {
  console.error(`preflight: ${error.message}`);
  process.exit(1);
}
const skipped = [...plan.skipped];

const derived = plan.checks.map((c) => {
  const ui = c.area === 'citadel-workspaces' || c.area === 'citadel-workspace-client-ts';
  if (c.kind === 'heavy') return { ...c, tiers: tag() };
  const source = c.script ? readFileSync(join(ROOT, c.script), 'utf8') : '';
  const slow = NOT_ON_PRE_COMMIT.has(gateKey([c.cmd, ...c.args]));
  return {
    ...c,
    tiers: tag(ui ? 'ui' : 'parent', ...(slow ? ['not-pre-commit'] : [])),
    relevance: { script: c.script, source, cwdArea: c.area, wholeRepo: readsWholeRepo(source) },
  };
});

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
} else {
  skipped.push(['rust wasm target compiles, fmt, clippy, tests', 'cargo is not on PATH']);
}

/** Paths this hook judges, relative to the parent. */
function changedPaths() {
  const prefix = repo === 'ui' ? 'citadel-workspaces/' : '';
  const dir = repo === 'ui' ? UI : ROOT;
  if (tier === 'pre-commit') return { paths: stagedPaths(dir, prefix), refs: [] };
  if (tier === 'pre-push') return pushedPaths(dir, prefix, remote, readFileSync(0, 'utf8'));
  return { paths: [], refs: [] };
}
const { paths, refs } = changedPaths();

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

/** Every UI branch push typechecks against the parent UI CI will resolve, not the local one -- changed paths or not. */
const uiPushTypecheck = repo === 'ui' && tier === 'pre-push'
  ? refs.filter((r) => r.remoteRef.startsWith('refs/heads/')).map((r) => {
    const branch = r.remoteRef.slice('refs/heads/'.length);
    return check(`UI typechecks against its CI parent (${branch})`, 'node',
      ['scripts/check-ui-typechecks-against-its-ci-parent.mjs', '--branch', branch, '--ui-sha', r.localSha], ROOT, tag('push'));
  })
  : [];

const CHECKS = [
  ...derived,
  // Not in validate.yml: by the time CI runs, checkout has already succeeded or died.
  check('submodule pointers pushed', 'node', ['scripts/check-submodule-pointers-pushed.mjs'], ROOT, tag('push')),
  // Before the TypeScript checks: without these artefacts they fail as if the source were broken.
  check('generated artefacts present', 'node', ['scripts/check-generated-artefacts-present.mjs'], ROOT, tag('ui', 'rust:agent')),
  // ts-rs drops imports named inside `#[ts(type = "...")]`; CI type-checks the bindings alone.
  check('generated bindings typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], join(IS, 'typescript-client'), tag('ui', 'rust:agent')),
  ...uiPushTypecheck,
  // The local typecheck stands in for the CI-parent one everywhere but a UI push.
  ...(uiPushTypecheck.length > 0 ? [] : [check('typecheck', 'npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], UI, tag('ui'))]),
  check('eslint', 'npx', ['eslint', '.', '--max-warnings', '0'], UI, tag('ui')),
  check('unit tests', 'npx', ['vitest', 'run'], UI, tag('ui')),
  ...preCommitOnly(),
  ...cargo,
];

if (process.argv.includes('--print-plan')) {
  // writeFileSync to fd 1: process.exit after console.log truncates a piped write at 8 KB.
  writeFileSync(1, `${JSON.stringify(CHECKS.map(({ name, cmd, args, cwd }) => ({ name, cmd, args, cwd })))}\n`);
  process.exit(0);
}

const started = Date.now();
console.log(`preflight --tier ${tier}${repo === 'ui' ? ' (UI repo)' : ''}${paths.length ? `: ${paths.length} changed path(s)` : ''}`);
await runFatal(ENVIRONMENT);
const selected = selectChecks(CHECKS, tier, paths, ROOT_CRATES);
const failed = await runChecks(selected);
const total = selected.length + ENVIRONMENT.length;
const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;

if (failed.length > 0) {
  printFailures(failed, total);
  console.error(`(${took}; bypass for one commit or push, deliberately: --no-verify)`);
  process.exit(1);
}
for (const [name, reason] of skipped) console.log(`  ${name} … skipped here (${reason})`);
console.log(`\nAll ${total} checks passed in ${took}.`);
