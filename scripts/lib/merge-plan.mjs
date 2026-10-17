/**
 * What merge-preview merges, and how it reports. Pure.
 *
 * GitHub validates each pull request against its base ALONE. Two pull requests that each pass
 * can still break the base together -- one removes a hook the other starts using, or each adds
 * lines to a file that is one under the cap -- and nothing runs on the combination until both
 * have merged. And a pull request that CONFLICTS with its base gets no `pull_request` run at all,
 * so its checks never start and nothing says so.
 */

/**
 * The pull requests to merge onto `base`, in number order, and the ones left out with a reason.
 * A pull request stacked on another branch merges into THAT branch, not into `base`, so it is
 * reported rather than merged.
 */
export function planMerges(prs, base) {
  const include = [];
  const excluded = [];
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    if (pr.baseRefName !== base) excluded.push({ ...pr, reason: `stacked on '${pr.baseRefName}', not '${base}'` });
    else if (pr.isCrossRepository) excluded.push({ ...pr, reason: 'from a fork; its head is not fetched' });
    else include.push(pr);
  }
  return { include, excluded };
}

/**
 * One line per pull request.
 *
 * `alone` is the pull request against `base` by itself: a conflict there means GitHub runs NO
 * checks for it. `together` is the cumulative merge, in number order: a conflict there only
 * means it collides with an earlier pull request in the list.
 */
export function verdictLines(results, excluded, tier) {
  const lines = [];
  for (const r of results) {
    const head = `#${r.number} ${r.headRefName}`;
    if (r.alone === 'conflict') {
      lines.push(`  CONFLICT  ${head} -- conflicts with the base itself: GitHub starts no pull_request run, so its CI never runs (${r.files.join(', ') || 'files not reported'})`);
    } else if (r.together === 'conflict') {
      lines.push(`  COLLIDES  ${head} -- merges alone, conflicts with an earlier PR in this list (${r.files.join(', ') || 'files not reported'})`);
    } else {
      lines.push(`  merged    ${head}`);
    }
  }
  for (const e of excluded) lines.push(`  skipped   #${e.number} ${e.headRefName} -- ${e.reason}`);
  if (tier) {
    lines.push('');
    lines.push(tier.failed.length === 0
      ? `  the combination passes the fast tier (${tier.ran} checks)`
      : `  the combination FAILS ${tier.failed.length} of ${tier.ran} fast-tier checks: ${tier.failed.join(', ')}`);
  }
  return lines;
}

/** The exit status: non-zero when any pull request conflicts or the combination fails. */
export function exitStatus(results, tier) {
  const conflicted = results.some((r) => r.alone === 'conflict' || r.together === 'conflict');
  return conflicted || (tier !== null && tier.failed.length > 0) ? 1 : 0;
}
