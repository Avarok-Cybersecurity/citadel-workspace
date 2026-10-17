#!/usr/bin/env node
/**
 * A pushed UI commit typechecks against the parent revision UI CI will actually resolve.
 *
 * UI CI does not build against your parent checkout. Its `parent-ref` job takes the parent
 * branch with the SAME NAME when the parent remote has one, and PARENT_BRANCH otherwise. A UI
 * branch pushed before its parent counterpart therefore typechecked against master, against
 * client types the change was not written for, and failed -- while every local typecheck passed,
 * because the local parent branch was right there.
 *
 * So this resolves the ref the way that job does (the remote's branches, not the local ones),
 * refuses the push when a same-name local parent branch is ahead of its remote, and otherwise
 * typechecks the PUSHED UI COMMIT -- not the working tree -- inside an overlay of that parent.
 *
 *   node scripts/check-ui-typechecks-against-its-ci-parent.mjs --branch <ui branch> --ui-sha <sha>
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowEnv } from './lib/workflow-steps.mjs';
import { decideParentRef, fallbackBranch } from './lib/parent-ref.mjs';
import { buildOverlay, git, makeScratch, prepareTypeScript, removeScratch, typeScriptSteps } from './lib/overlay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function option(name) {
  const at = process.argv.indexOf(name);
  const value = at < 0 ? undefined : process.argv[at + 1];
  if (!value) {
    console.error(`usage: ${process.argv[1]} --branch <ui branch> --ui-sha <sha>  (${name} is missing)`);
    process.exit(2);
  }
  return value;
}

const branch = option('--branch');
const uiSha = option('--ui-sha');
const fallback = fallbackBranch(workflowEnv(readFileSync(join(ROOT, 'citadel-workspaces/.github/workflows/validate.yml'), 'utf8')));

/** The parent remote's branches, read live: CI resolves from the remote, so the local refs do not count. */
function remoteHeads() {
  const out = execFileSync('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`, `refs/heads/${fallback}`], { cwd: ROOT, encoding: 'utf8' });
  return new Map(out.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split('\t');
    return [ref.replace('refs/heads/', ''), sha];
  }));
}

function localBranch(remoteSha) {
  let sha;
  try {
    sha = git(ROOT, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  } catch {
    return null;
  }
  if (remoteSha === null) return { sha, ahead: Number.NaN };
  // The remote branch may hold commits this clone never fetched; ahead-ness needs them.
  if (spawnSync('git', ['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: ROOT }).status !== 0) git(ROOT, 'fetch', '--quiet', 'origin', branch);
  return { sha, ahead: Number(git(ROOT, 'rev-list', '--count', `${remoteSha}..${sha}`)) };
}

const heads = remoteHeads();
const fallbackSha = heads.get(fallback);
if (!fallbackSha) {
  console.error(`FAIL: the parent remote has no '${fallback}' branch (PARENT_BRANCH in the UI workflow).`);
  process.exit(1);
}
const remoteSha = heads.get(branch) ?? null;
const decision = decideParentRef({ branch, fallback, remoteSha, fallbackSha, local: localBranch(remoteSha) });
if (decision.verdict === 'refuse') {
  console.error(`REFUSED: ${decision.why}`);
  process.exit(1);
}
console.log(`UI CI will build '${branch}' against parent ${decision.ref} = ${decision.sha.slice(0, 12)} (${decision.why}).`);

const dir = makeScratch('ci-parent');
let failed = false;
try {
  buildOverlay({ root: ROOT, dir, parentSha: decision.sha, uiSha, agentSha: null });
  prepareTypeScript(ROOT, dir);
  for (const [label, argv] of typeScriptSteps(ROOT, dir)) {
    const run = spawnSync(argv[0], argv.slice(1), { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) {
      console.error(`FAIL: ${label}, in the parent CI will use:\n${`${run.stdout}${run.stderr}`.trim().split('\n').slice(0, 40).join('\n')}`);
      failed = true;
      break;
    }
    console.log(`  ${label}: ok`);
  }
} finally {
  removeScratch(dir);
}
if (failed) {
  console.error(`\nThe UI commit ${uiSha.slice(0, 12)} does not typecheck against parent ${decision.ref}.` +
    (decision.ref === fallback ? `\nIf it needs parent changes, put them on a parent branch named '${branch}' and push that first.` : ''));
  process.exit(1);
}
console.log(`OK: ${uiSha.slice(0, 12)} typechecks against the parent UI CI will resolve.`);
