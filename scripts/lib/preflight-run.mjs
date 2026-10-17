/**
 * Runs preflight's checks: the `node` gates concurrently, everything else in order.
 *
 * Only `node scripts/*.mjs` and `node --test` run in parallel. They read the tree and print;
 * the builds, `npm` scripts, tsc, eslint, vitest and cargo write output directories or share a
 * target lock, and `npm run build && npm run check:bundle` has to stay in that order.
 */
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

// SKIP_WASM_BUILD keeps the cargo gates from rebuilding the WASM client and overwriting the
// tracked artifacts under it (citadel-workspace-internal-service's build script runs wasm-pack).
const BASE_ENV = { SKIP_WASM_BUILD: '1' };

/**
 * Git hands a hook the variables that locate ITS repository. Inherited by a gate that runs git
 * in another repo -- the UI hook's gates run in the parent -- they silently point that gate at
 * the UI's index and object store. The hook's own git reads happen before this, in-process.
 */
const REPO_LOCATORS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !REPO_LOCATORS.includes(key)));

function runOne({ cmd, args, cwd, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...inherited, ...env, ...BASE_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, ms: 0, output: `${error.message}\n(the command could not be started; nothing ran)` });
      return;
    }
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    // `error` is the case where the command never STARTED -- a missing binary, an unreadable
    // cwd. Reporting only the (empty) output printed a failure header over an empty block.
    child.on('error', (error) => resolve({ ok: false, ms: Date.now() - started, output: `${error.message}\n(the command could not be started; nothing ran)` }));
    child.on('close', (code) => resolve({ ok: code === 0, ms: Date.now() - started, output: output.trim() }));
  });
}

const parallelSafe = (check) => check.cmd === 'node';
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** Runs `checks`; returns the failures. Prints one line per check as it finishes. */
export async function runChecks(checks) {
  const failed = [];
  const report = (check, result) => {
    console.log(`  ${check.name} … ${result.ok ? 'ok' : 'FAILED'} (${seconds(result.ms)})`);
    if (!result.ok) failed.push({ name: check.name, output: result.output });
  };
  const pool = checks.filter(parallelSafe);
  const serial = checks.filter((c) => !parallelSafe(c));
  let next = 0;
  const worker = async () => {
    while (next < pool.length) {
      const check = pool[next++];
      report(check, await runOne(check));
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), pool.length) }, worker));
  for (const check of serial) report(check, await runOne(check));
  return failed;
}

/** Runs checks that must pass before anything else means anything; exits on the first failure. */
export async function runFatal(checks) {
  for (const check of checks) {
    const result = await runOne(check);
    console.log(`  ${check.name} … ${result.ok ? 'ok' : 'FAILED'} (${seconds(result.ms)})`);
    if (!result.ok) {
      console.error(`\n${result.output}\n`);
      console.error('Stopping here. Every remaining check reads this tree, so they would all fail\nfor this one reason and bury it.');
      process.exit(1);
    }
  }
}

export function printFailures(failed, total) {
  for (const { name, output } of failed) console.error(`\n─── ${name} ───\n${output.split('\n').slice(-40).join('\n')}`);
  console.error(`\n${failed.length} of ${total} checks failed.`);
}
