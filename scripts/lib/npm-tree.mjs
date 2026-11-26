/**
 * What `npm ls --all --json` says is wrong with the installed tree, against a baseline (pure).
 *
 * `npm ci` installs exactly what package-lock.json lists; it does not check that every package there
 * satisfies the ranges the workspaces' package.json files ask for. `npm ls` does: an invalid, missing
 * or extraneous package means the lockfile no longer describes the manifests (a merge that resolved a
 * lockfile conflict by hand does this). Problems are compared with the repository path taken out, so
 * one baseline reads the same on every machine and in CI.
 */

/** @param {{ problems?: string[] }} lsJson @param {string} root the absolute repository path */
export function npmTreeProblems(lsJson, root) {
  return [...new Set((lsJson.problems ?? []).map((p) => p.split(root).join('<repo>')))].sort();
}

/** Problems not in the baseline (new), and baseline entries that no longer occur (fixed). */
export function compareProblems(problems, baseline) {
  const known = new Set(baseline);
  const now = new Set(problems);
  return { added: problems.filter((p) => !known.has(p)), fixed: baseline.filter((p) => !now.has(p)) };
}
