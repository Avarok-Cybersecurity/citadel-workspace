#!/usr/bin/env node
/**
 * What master looks like once every open pull request has merged -- before any of them has.
 *
 *   node scripts/merge-preview.mjs --repo parent   the parent's open PRs, onto its master
 *   node scripts/merge-preview.mjs --repo ui       the UI repo's, inside the parent's master
 *   node scripts/merge-preview.mjs --repo agent    the agent repo's, likewise
 *   node scripts/merge-preview.mjs --repo cross    the parent's master with BOTH submodule
 *                                                  pointers moved to their merged previews
 *
 * Two UI pull requests each passed alone and broke master together: one started using a hook
 * the other removed, and the two together took a file to 251 lines. And an agent pull request
 * changed a type compiled into the WASM client, which only the PARENT's "wasm matches its source"
 * gate could see -- after merge. GitHub validates each pull request against its base alone, and
 * gives one that CONFLICTS with its base no pull_request run at all, so its CI silently never
 * starts. This merges them all (lib/merge-run.mjs), reports each one, and runs the fast tier --
 * the static gates and the TypeScript build -- on the combination.
 *
 * Read-only toward GitHub (`gh pr list`, `git fetch`). Everything happens in a scratch directory
 * of shared clones (lib/overlay.mjs), removed at the end. No cargo build runs, so no Rust target
 * directory is made per preview; the agent's fast tier is `cargo fmt --check`, which compiles
 * nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitStatus, verdictLines } from './lib/merge-plan.mjs';
import { mergeOpenPullRequests, slugOf } from './lib/merge-run.mjs';
import { AGENT_DIR, UI_DIR, attachIlm, attachSubmodules, buildOverlay, checkout, git, makeScratch, prepareTypeScript, recordPointer, removeScratch, sharedClone, typeScriptSteps } from './lib/overlay.mjs';
import { MERGE_PREVIEW_CANNOT_JUDGE, derivedChecks, gateKey } from './lib/preflight-plan.mjs';
import { printFailures, runChecks } from './lib/preflight-run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODES = ['parent', 'ui', 'agent', 'cross'];

const at = process.argv.indexOf('--repo');
const mode = at < 0 ? null : process.argv[at + 1];
if (!MODES.includes(mode)) {
  console.error(`usage: node scripts/merge-preview.mjs --repo ${MODES.join('|')}`);
  process.exit(2);
}

const slug = (dir) => slugOf(git(dir, 'remote', 'get-url', 'origin'));
const defaultBranch = (s) => execFileSync('gh', ['repo', 'view', s, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], { encoding: 'utf8' }).trim();

/** The parent remote's default branch head: the parent every submodule preview sits in. */
function parentMasterSha() {
  const branch = defaultBranch(slug(ROOT));
  const line = git(ROOT, 'ls-remote', 'origin', `refs/heads/${branch}`);
  if (!line) throw new Error(`the parent remote has no ${branch}`);
  return line.split('\t')[0];
}

/** `npm run <x>` whose script is a single `node <file>` becomes that node command; any other npm use is refused. */
function withoutNpm(check) {
  if (check.cmd !== 'npm') return check;
  const name = check.args[0] === 'run' ? check.args[1] : null;
  const body = name ? JSON.parse(readFileSync(join(check.cwd, 'package.json'), 'utf8')).scripts?.[name] : null;
  const node = body && !/&&|\||;/.test(body) ? /^node\s+(.+)$/.exec(body.trim()) : null;
  if (!node) return { ...check, skip: `runs npm (${check.args.join(' ')}), and npm must never run in the overlay` };
  return { ...check, cmd: 'node', args: node[1].split(/\s+/) };
}

/** The fast tier on an overlay: its own workflows' static gates, then the TypeScript build. */
async function fastTier(overlay) {
  const { checks } = derivedChecks(overlay);
  const skipped = [];
  const run = [];
  for (const check of checks.filter((c) => c.kind === 'static')) {
    const reason = MERGE_PREVIEW_CANNOT_JUDGE.get(gateKey([check.cmd, ...check.args]));
    const converted = reason ? { ...check, skip: reason } : withoutNpm(check);
    if (converted.skip) skipped.push(`${check.name}: ${converted.skip}`);
    else run.push(converted);
  }
  prepareTypeScript(ROOT, overlay);
  const failures = await runChecks(run);
  if (failures.length > 0) printFailures(failures, run.length);
  const failed = failures.map((f) => f.name);
  for (const [label, argv] of typeScriptSteps(ROOT, overlay)) {
    const step = spawnSync(argv[0], argv.slice(1), { cwd: overlay, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    console.log(`  ${label} … ${step.status === 0 ? 'ok' : 'FAILED'}`);
    if (step.status !== 0) {
      failed.push(label);
      console.error(`${step.stdout}${step.stderr}`.trim().split('\n').slice(0, 30).join('\n'));
      break;
    }
  }
  for (const s of skipped) console.log(`  skipped in a merge preview: ${s}`);
  return { ran: run.length + 3, failed };
}

/** Merges one submodule's open PRs inside the parent overlay and records the pointer. */
function previewSubmodule(overlay, path) {
  const dir = join(overlay, path);
  const merge = mergeOpenPullRequests(dir, slug(join(ROOT, path)));
  checkout(dir, merge.head);
  if (path === AGENT_DIR) attachIlm(ROOT, overlay);
  recordPointer(overlay, path, merge.head, `preview: ${path} with its open PRs`);
  return { path, ...merge };
}

const scratch = makeScratch('merge-preview');
const overlay = join(scratch, 'parent');
let status = 1;
try {
  const previews = [];
  if (mode === 'parent') {
    sharedClone(ROOT, overlay);
    const merge = mergeOpenPullRequests(overlay, slug(ROOT));
    checkout(overlay, merge.head);
    attachSubmodules(ROOT, overlay, null, null);
    previews.push({ path: 'parent', ...merge });
  } else {
    buildOverlay({ root: ROOT, dir: overlay, parentSha: parentMasterSha(), uiSha: null, agentSha: null });
    if (mode === 'ui' || mode === 'cross') previews.push(previewSubmodule(overlay, UI_DIR));
    if (mode === 'agent' || mode === 'cross') previews.push(previewSubmodule(overlay, AGENT_DIR));
  }
  for (const p of previews) {
    console.log(`\n${p.path}: ${p.results.length} open PR(s) into ${p.base} (${p.baseSha.slice(0, 12)}) -> preview ${p.head.slice(0, 12)}`);
    console.log(verdictLines(p.results, p.excluded, null).join('\n'));
  }
  console.log('\nfast tier on the combination:');
  const tier = await fastTier(overlay);
  if (mode === 'agent' || mode === 'cross') {
    const fmt = spawnSync('cargo', ['fmt', '--all', '--check'], { cwd: join(overlay, AGENT_DIR), encoding: 'utf8', env: { ...process.env, CARGO_NET_OFFLINE: 'true' } });
    console.log(`  agent cargo fmt … ${fmt.status === 0 ? 'ok' : 'FAILED'}`);
    tier.ran += 1;
    if (fmt.status !== 0) tier.failed.push('agent cargo fmt');
  }
  const du = execFileSync('du', ['-sk', scratch], { encoding: 'utf8' }).split('\t')[0];
  console.log(`\n${verdictLines([], [], tier).join('\n').trim()}\n  (scratch used ${(Number(du) / 1024).toFixed(0)} MB; removed)`);
  status = Math.max(...previews.map((p) => exitStatus(p.results, null)), exitStatus([], tier));
} finally {
  removeScratch(scratch);
}
process.exit(status);
