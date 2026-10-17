/**
 * The paths a commit or a push changes, as the hooks see them. The git reads for change-tiers.mjs.
 *
 * Paths come back relative to the PARENT checkout: a hook in the UI repo prefixes its own paths
 * with `citadel-workspaces/`, so one set of tier rules serves both repos.
 */
import { git } from './overlay.mjs';

const ZERO = /^0+$/;

const list = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Staged paths: added, copied, modified, renamed (a deletion leaves nothing to check). */
export function stagedPaths(repo, prefix) {
  return list(git(repo, 'diff', '--cached', '--name-only', '--diff-filter=ACMR')).map((p) => prefix + p);
}

/** The branch a new remote branch is compared against: the remote's default, which a clone records. */
function remoteDefault(repo, remote) {
  try {
    return git(repo, 'symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`);
  } catch {
    throw new Error(`refs/remotes/${remote}/HEAD is not set in ${repo}, so a new branch has nothing to be compared with.\n` +
      `  fix: git -C ${repo} remote set-head ${remote} --auto`);
  }
}

/**
 * Paths changed by the refs a pre-push hook is given on stdin
 * (`<local ref> <local sha> <remote ref> <remote sha>` per line).
 *
 * Against the remote's current sha when the remote has the branch and this clone has that
 * commit; against the merge base with the remote's default branch when it is new. A deletion
 * changes nothing.
 */
export function pushedPaths(repo, prefix, remote, stdin) {
  const paths = new Set();
  const refs = [];
  for (const line of list(stdin)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (ZERO.test(localSha)) continue;
    let base = null;
    if (!ZERO.test(remoteSha)) {
      try {
        git(repo, 'cat-file', '-e', `${remoteSha}^{commit}`);
        base = remoteSha;
      } catch {
        // The remote moved past anything fetched here; compare with the merge base instead.
      }
    }
    if (base === null) base = git(repo, 'merge-base', localSha, remoteDefault(repo, remote));
    for (const p of list(git(repo, 'diff', '--name-only', base, localSha))) paths.add(prefix + p);
    refs.push({ localRef, localSha, remoteRef });
  }
  return { paths: [...paths], refs };
}
