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
 * @param {{ sha: string, unpushed: string[] } | null} input.local  the LOCAL parent branch of
 *   that name -- `unpushed` lists the paths its commits change that the parent CI resolves (the
 *   remote branch, else the fallback) lacks, the UI pointer excluded -- or null when there is none
 *
 * The UI pointer does not count. UI CI checks THIS commit out over the parent's pointer, so a
 * parent branch that only moves the pointer resolves the same either way -- and the pointer
 * cannot be pushed first anyway: the parent's pre-push refuses a pointer the UI remote lacks.
 */
export function decideParentRef({ branch, fallback, remoteSha, fallbackSha, local }) {
  if (local !== null && branch !== fallback && local.unpushed.length > 0) {
    const what = `${local.unpushed.length} path(s) UI CI will not see (${local.unpushed.slice(0, 5).join(', ')}${local.unpushed.length > 5 ? ', ...' : ''})`;
    if (remoteSha === null) {
      return refuse(branch, `the parent has a local '${branch}' that is not on its remote, so UI CI would resolve '${fallback}' instead and miss ${what}`);
    }
    return refuse(branch, `the parent's local '${branch}' is ahead of its remote by ${what}`);
  }
  if (remoteSha !== null) return { verdict: 'ok', ref: branch, sha: remoteSha, why: `the parent has a '${branch}' branch` };
  return { verdict: 'ok', ref: fallback, sha: fallbackSha, why: `the parent has no '${branch}' branch, so CI falls back to '${fallback}'` };
}

function refuse(branch, why) {
  return {
    verdict: 'refuse',
    ref: null,
    sha: null,
    why: `${why}.\n  Push the parent first: git -C <parent> push origin ${branch}\n  (UI CI resolves its parent when the run starts, so the order matters. If that parent commit also\n  moves the UI pointer, push the parent's changes without the pointer bump, then this, then the bump.)`,
  };
}

/** The UI branch a pre-push line pushes, or null for a deletion or a non-branch ref. */
export function pushedBranch(line) {
  const [localRef, localSha, remoteRef] = line.trim().split(/\s+/);
  if (!remoteRef?.startsWith('refs/heads/') || /^0+$/.test(localSha ?? '')) return null;
  return { branch: remoteRef.slice('refs/heads/'.length), localRef, sha: localSha };
}
