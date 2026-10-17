/**
 * The git half of merge-preview: fetch every open PR head into a scratch clone and merge them,
 * alone and together, without a working tree. `git merge-tree --write-tree` computes each merge
 * in the object store and `commit-tree` records it, so nothing is checked out until the final
 * combination, and the source clone is never written to.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { planMerges } from './merge-plan.mjs';
import { git } from './overlay.mjs';

const IDENT = ['-c', 'user.name=merge-preview', '-c', 'user.email=merge-preview@localhost'];

/** `owner/name` of a GitHub remote URL. */
export function slugOf(url) {
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(\.git)?\/?$/.exec(url);
  if (!m) throw new Error(`not a GitHub remote: ${url}`);
  return m[1];
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The repo's default branch and its open PRs, read-only. */
export function openPullRequests(slug) {
  const base = gh(['repo', 'view', slug, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']).trim();
  const prs = JSON.parse(gh(['pr', 'list', '-R', slug, '--state', 'open', '--limit', '200',
    '--json', 'number,title,headRefName,baseRefName,isCrossRepository,headRefOid']));
  return { base, prs };
}

/** `{ clean, tree, files }` for merging `theirs` into `ours`. */
function mergeTree(repo, ours, theirs) {
  const run = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs], { cwd: repo, encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(`git merge-tree failed in ${repo}: ${run.stderr}`);
  const [tree, ...files] = run.stdout.trim().split('\n');
  return { clean: run.status === 0, tree, files: files.filter(Boolean) };
}

/**
 * Merges every open PR into the base, in a scratch clone at `repo`.
 * Returns the per-PR results, the excluded PRs, and the commit of the combination.
 */
export function mergeOpenPullRequests(repo, slug) {
  const { base, prs } = openPullRequests(slug);
  const { include, excluded } = planMerges(prs, base);
  const refspecs = [`+refs/heads/${base}:refs/preview/base`, ...include.map((p) => `+refs/pull/${p.number}/head:refs/preview/pr/${p.number}`)];
  git(repo, 'fetch', '--quiet', '--no-tags', 'origin', ...refspecs);
  const baseSha = git(repo, 'rev-parse', 'refs/preview/base');
  const results = [];
  let head = baseSha;
  for (const pr of include) {
    const ref = `refs/preview/pr/${pr.number}`;
    const alone = mergeTree(repo, baseSha, ref);
    const result = { number: pr.number, headRefName: pr.headRefName, alone: alone.clean ? 'clean' : 'conflict', together: 'skipped', files: alone.files };
    if (alone.clean) {
      const together = mergeTree(repo, head, ref);
      if (together.clean) {
        head = git(repo, ...IDENT, 'commit-tree', together.tree, '-p', head, '-p', ref, '-m', `preview: merge #${pr.number} ${pr.headRefName}`);
        result.together = 'merged';
      } else {
        result.together = 'conflict';
        result.files = together.files;
      }
    }
    results.push(result);
  }
  return { base, baseSha, results, excluded, head };
}
