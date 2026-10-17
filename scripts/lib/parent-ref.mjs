/**
 * Which parent revision the UI repo's CI will build against, and whether a push is premature.
 * Pure: the git and network reads happen in the caller.
 *
 * The UI workflow's `parent-ref` job checks the parent out at a branch with the SAME NAME as
 * the one under test when the parent remote has one, and at `PARENT_BRANCH` otherwise. So a UI
 * branch pushed before its parent counterpart is validated against the fallback -- usually
 * master -- and typechecks against types the change was never written for. Locally everything
 * passes, because the local parent branch is right there.
 */

/** The `PARENT_BRANCH` the UI workflow falls back to, read from the workflow's env. */
export function fallbackBranch(env) {
  const value = env.PARENT_BRANCH;
  if (typeof value !== 'string' || value === '' || value.includes('${{')) {
    throw new Error("the UI workflow's top-level env has no literal PARENT_BRANCH; the parent-ref job cannot be mirrored");
  }
  return value;
}

/**
 * The decision for one pushed UI branch.
 *
 * @param {object} input
 * @param {string} input.branch          the UI branch being pushed
 * @param {string} input.fallback        PARENT_BRANCH from the UI workflow
 * @param {string|null} input.remoteSha  the parent remote's `branch`, or null when it has none
 * @param {string} input.fallbackSha     the parent remote's `fallback`
 * @param {{ sha: string, ahead: number } | null} input.local  the LOCAL parent branch of that
 *   name -- `ahead` counts its commits the remote branch lacks -- or null when there is none
 */
export function decideParentRef({ branch, fallback, remoteSha, fallbackSha, local }) {
  if (local !== null && branch !== fallback) {
    if (remoteSha === null) {
      return refuse(branch, `the parent has a local '${branch}' that is not on its remote, so UI CI would resolve '${fallback}' instead`);
    }
    if (local.ahead > 0) {
      return refuse(branch, `the parent's local '${branch}' is ${local.ahead} commit(s) ahead of its remote, so UI CI would build against the older parent`);
    }
  }
  if (remoteSha !== null) return { verdict: 'ok', ref: branch, sha: remoteSha, why: `the parent has a '${branch}' branch` };
  return { verdict: 'ok', ref: fallback, sha: fallbackSha, why: `the parent has no '${branch}' branch, so CI falls back to '${fallback}'` };
}

function refuse(branch, why) {
  return {
    verdict: 'refuse',
    ref: null,
    sha: null,
    why: `${why}.\n  Push the parent first: git -C <parent> push origin ${branch}\n  (the UI repo's CI resolves its parent when the run starts, so the order matters)`,
  };
}

/** The UI branch a pre-push line pushes, or null for a deletion or a non-branch ref. */
export function pushedBranch(line) {
  const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
  if (!remoteRef?.startsWith('refs/heads/') || /^0+$/.test(localSha ?? '')) return null;
  return { branch: remoteRef.slice('refs/heads/'.length), localRef, sha: localSha };
}
