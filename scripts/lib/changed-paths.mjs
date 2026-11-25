/**
 * The paths a commit or a push changes, as the hooks see them. The git reads for change-tiers.mjs.
 *
 * Paths come back relative to the PARENT checkout: a hook in the UI repo prefixes its own paths
 * with `citadel-workspaces/`, so one set of tier rules serves both repos.
 */
import { git } from './overlay.mjs';
import { defaultBranchOf, pushRemote } from './push-remote.mjs';

const ZERO = /^0+$/;

const list = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** Staged paths: added, copied, modified, renamed (a deletion leaves nothing to check). */
export function stagedPaths(repo, prefix) {
  return list(git(repo, 'diff', '--cached', '--name-only', '--diff-filter=ACMR')).map((p) => prefix + p);
}

/** The branch a new remote branch is compared against: the remote's default, which a clone records. */
export function remoteDefault(repo, remote) {
  const names = new Set([remote, 'origin']);
  const heads = new Map([...names].map((name) => [name, symbolicRef(repo, `refs/remotes/${name}/HEAD`)]));
  return defaultBranchOf(remote, heads);
}

function symbolicRef(repo, ref) {
  try {
    return git(repo, 'symbolic-ref', '--quiet', ref);
  } catch {
    return null;
  }
}

/** Every configured remote with its url and pushurls (`remote.<name>.url`, `remote.<name>.pushurl`). */
function remotesOf(repo) {
  let config = '';
  try {
    config = git(repo, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$');
  } catch {
    return [];
  }
  const byName = new Map();
  for (const line of list(config)) {
    const m = /^remote\.(.+)\.(?:url|pushurl) (.+)$/.exec(line);
    if (m) byName.set(m[1], [...(byName.get(m[1]) ?? []), m[2]]);
  }
  return [...byName].map(([name, urls]) => ({ name, urls }));
}

/**
 * The commits a push introduces to `remote`: reachable from `localSha` and from no ref of that
 * remote. Each was never gated by a push; every other commit was, when it reached the remote.
 * `boundary` holds the remote-known parents they grow from: empty when no ancestor is on the remote.
 */
function newCommits(repo, remote, localSha) {
  const lines = list(git(repo, 'rev-list', '--boundary', localSha, '--not', `--remotes=${remote}`));
  return {
    commits: lines.filter((l) => !l.startsWith('-')),
    boundary: lines.filter((l) => l.startsWith('-')).map((l) => l.slice(1)),
  };
}

/**
 * Paths changed by the refs a pre-push hook is given on stdin
 * (`<local ref> <local sha> <remote ref> <remote sha>` per line).
 *
 * Only the commits no ref of the remote has yet are judged, diffed from the remote-known
 * commits they grow from. A new branch cut from a release branch used to be diffed against the
 * remote's DEFAULT branch, so the release's own commits -- already gated when they were pushed --
 * were judged again as this push's: a UI-only branch ran the whole agent test suite. A branch
 * whose history the remote has none of still falls back to the merge base with the remote's
 * default branch. A deletion, or a push of commits the remote already has, changes nothing.
 * `remoteArg` is git's `$1`: a remote name, or the URL of a push to a URL (lib/push-remote.mjs).
 */
export function pushedPaths(repo, prefix, remoteArg, stdin) {
  const { remote } = pushRemote(remoteArg, remotesOf(repo));
  const paths = new Set();
  const refs = [];
  for (const line of list(stdin)) {
    const [localRef, localSha, remoteRef] = line.split(/\s+/);
    if (ZERO.test(localSha)) continue;
    refs.push({ localRef, localSha, remoteRef });
    const { commits, boundary } = newCommits(repo, remote, localSha);
    if (commits.length === 0) continue;
    const bases = boundary.length > 0 ? boundary : [git(repo, 'merge-base', localSha, remoteDefault(repo, remote))];
    for (const base of bases) {
      for (const p of list(git(repo, 'diff', '--name-only', base, localSha))) paths.add(prefix + p);
    }
  }
  return { paths: [...paths], refs };
}
