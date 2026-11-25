/**
 * Which configured remote a push goes to, and whose default branch a new branch is compared with (pure).
 *
 * git hands pre-push the remote as `$1`: a remote's NAME for `git push origin`, but the URL itself for
 * `git push https://…`. Commits are judged against the refs a remote NAME has, so a URL resolves to the
 * configured remote whose url or pushurl is the same repository (an ssh and an https spelling of one
 * GitHub repo are the same), and to `origin` when none is. A remote without a recorded default branch
 * falls back to origin's.
 */

/** `git@host:a/b.git`, `ssh://git@host/a/b`, `https://user@host/a/b.git/` all become `host/a/b`. */
export function repoIdentity(url) {
  const scp = /^[^@/:]+@([^:/]+):(.+)$/.exec(url);
  const parsed = scp ? { host: scp[1], path: scp[2] } : (() => {
    const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url);
    return m ? { host: m[1], path: m[2] } : { host: '', path: url };
  })();
  const path = parsed.path.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+/, '');
  return `${parsed.host.toLowerCase()}/${path}`;
}

/**
 * @param {string} arg what git passed as `$1`
 * @param {{name: string, urls: string[]}[]} remotes every configured remote with its url and pushurls
 * @returns {{remote: string, how: string}}
 */
export function pushRemote(arg, remotes) {
  if (remotes.some((r) => r.name === arg)) return { remote: arg, how: 'named' };
  const id = repoIdentity(arg);
  const matching = remotes.filter((r) => r.urls.some((u) => repoIdentity(u) === id)).map((r) => r.name);
  if (matching.length === 1) return { remote: matching[0], how: `url of remote '${matching[0]}'` };
  if (matching.includes('origin')) return { remote: 'origin', how: `url of several remotes (${matching.join(', ')}); origin's refs` };
  if (remotes.some((r) => r.name === 'origin')) return { remote: 'origin', how: 'url matches no remote; origin\'s refs' };
  throw new Error(`the push goes to ${arg}, which no configured remote points at, and there is no 'origin' to compare with.\n` +
    `  fix: git remote add origin ${arg}   (then git fetch origin && git remote set-head origin --auto)`);
}

/**
 * @param {string} remote
 * @param {Map<string, string|null>} heads each remote's recorded default branch ref, or null
 */
export function defaultBranchOf(remote, heads) {
  const own = heads.get(remote) ?? null;
  if (own) return own;
  const origin = heads.get('origin') ?? null;
  if (origin) return origin;
  throw new Error(`refs/remotes/${remote}/HEAD is not set (nor origin's), so a new branch has nothing to be compared with.\n` +
    `  fix: git remote set-head ${remote} --auto`);
}
