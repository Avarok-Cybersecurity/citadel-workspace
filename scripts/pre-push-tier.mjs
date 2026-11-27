#!/usr/bin/env node
/**
 * Runs exactly what the pre-push hook judges for the branch checked out, with no push in flight:
 *
 *   node scripts/pre-push-tier.mjs --remote origin
 *
 * It does not re-implement the hook: it RUNS it (`git hook run pre-push`), feeding the ref line git
 * would feed for HEAD, in run mode (PREFLIGHT_PRE_PUSH=run). Going through git matters: git gives
 * hooks their own environment (its exec dir on PATH; on macOS the xcrun shim's SDKROOT, CPATH,
 * MANPATH), and a pass is stamped over the environment, so only a run inside git can produce the
 * stamps the hook inside `git push` then verifies in seconds (lib/preflight-push.mjs).
 *
 * The change set does not depend on the remote ref: it is every commit reachable from HEAD that no
 * ref of the remote has (lib/changed-paths.mjs). Waits for the machine-wide hook lock.
 * Run it with plain `node` (not `npm run`, which adds npm_* variables and PATH entries to the key).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const at = process.argv.indexOf('--remote');
const remote = at >= 0 ? process.argv[at + 1] : undefined;
if (!remote || process.argv.length !== 4) {
  console.error('usage: node scripts/pre-push-tier.mjs --remote <name>   (the remote you will push to, e.g. origin)');
  process.exit(2);
}
if (process.env.npm_lifecycle_event !== undefined) {
  console.error('pre-push-tier: run it with plain node, not through npm: npm adds variables the push will not have,\n  so the stamps would never match. node scripts/pre-push-tier.mjs --remote <name>');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Without core.hooksPath there is no hook to run, and the push after it would run none either.
const hooks = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'check-hooks-are-installed.mjs')], { stdio: 'inherit' });
if (hooks.status !== 0) {
  console.error('pre-push-tier: the hooks are not installed in this clone, so neither this tier nor the push would be judged.\n  fix: scripts/bootstrap.sh');
  process.exit(1);
}
const ZERO = '0'.repeat(40);
let url;
try {
  url = git('remote', 'get-url', '--push', remote);
} catch {
  console.error(`pre-push-tier: there is no remote '${remote}' here.`);
  process.exit(2);
}
const head = git('rev-parse', 'HEAD');
let branch;
try {
  branch = git('symbolic-ref', '--quiet', 'HEAD');
} catch {
  console.error('pre-push-tier: HEAD is detached; check out the branch you are going to push.');
  process.exit(2);
}
let remoteSha = ZERO;
try {
  remoteSha = git('rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch.replace(/^refs\/heads\//, '')}`);
} catch {
  // A branch the remote does not have yet: git feeds zeros for it too.
}

const dir = mkdtempSync(join(tmpdir(), 'pre-push-tier-'));
const refs = join(dir, 'refs');
writeFileSync(refs, `${branch} ${head} ${branch} ${remoteSha}\n`);
console.log(`pre-push-tier: running the pre-push hook for ${branch} at ${head.slice(0, 10)} against ${remote}`);
const result = spawnSync('git', ['hook', 'run', 'pre-push', `--to-stdin=${refs}`, '--', remote, url],
  { stdio: 'inherit', env: { ...process.env, PREFLIGHT_PRE_PUSH: 'run' } });
rmSync(dir, { recursive: true, force: true });
if (result.error) {
  console.error(`pre-push-tier: could not run git hook run (${result.error.message}); it needs a git whose 'hook run' takes --to-stdin.`);
  process.exit(2);
}
process.exit(result.status ?? 1);
