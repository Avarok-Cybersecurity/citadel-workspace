/**
 * What will stop a green pull request from merging, predicted from a repository's live branch
 * rule. Pure: scripts/merge-blockability.mjs reads the rule and the CODEOWNERS file and passes
 * them in. Each rule is one that held a merge:
 *
 *   - a required check no pull_request job produces ("tests (ubuntu-latest)" against a matrix
 *     saying ubuntu-24.04, release/robust-1119, 2026-11-21) waits forever as "expected";
 *   - require_code_owner_reviews with a CODEOWNERS file needs an owner's approval, and an owner
 *     cannot approve their own PR: the SDK's `* @tbraun96` held #397 after every check was green;
 *   - required_approving_review_count > 0 needs a human, so no bot PR merges unattended;
 *   - a declared list (.github/required-checks.json) that differs from the live rule means the CI
 *     check judged the wrong names.
 *
 * `strict` (up to date before merging) is a warning, not a blocker: it holds a PR only once
 * master moves past it, and `gh pr update-branch` clears it.
 */

/** Contexts from either protection shape (`contexts`, or `checks[].context`). */
export function liveContexts(protection) {
  const checks = protection?.required_status_checks;
  if (!checks) return [];
  const names = new Set([...(checks.contexts ?? []), ...(checks.checks ?? []).map((c) => c.context)]);
  return [...names].sort();
}

/**
 * @param {{ protection: object, codeowners: string | null, declared: string[] | null,
 *   produced: Set<string> | null, external: string[] }} facts
 *   declared/produced are null for a repository .github/required-checks.json does not list.
 */
export function mergeBlockers({ protection, codeowners, declared, produced, external }) {
  const blockers = [];
  const warnings = [];
  const live = liveContexts(protection);
  if (produced) {
    for (const name of live) {
      if (!produced.has(name) && !external.includes(name)) {
        blockers.push(`required check "${name}" is produced by no pull_request job: it will wait as "expected" forever`);
      }
    }
  }
  if (declared) {
    const want = [...declared].sort();
    const extra = live.filter((n) => !want.includes(n));
    const gone = want.filter((n) => !live.includes(n));
    if (extra.length || gone.length) {
      blockers.push(
        `.github/required-checks.json differs from the live rule (live only: ${extra.join(', ') || 'none'}; ` +
          `declared only: ${gone.join(', ') || 'none'}): CI judged the wrong names`,
      );
    }
  }
  const reviews = protection?.required_pull_request_reviews;
  const owners = (codeowners ?? '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (reviews?.require_code_owner_reviews && owners.length > 0) {
    blockers.push(
      `require_code_owner_reviews is on and CODEOWNERS names owners (${owners[0].trim()}${owners.length > 1 ? ', ...' : ''}): ` +
        'a code owner other than the author must approve',
    );
  }
  if ((reviews?.required_approving_review_count ?? 0) > 0) {
    blockers.push(`${reviews.required_approving_review_count} approving review(s) required: a bot PR cannot merge unattended`);
  }
  if (protection?.required_status_checks?.strict) {
    warnings.push('strict: the branch must be up to date with master; once master moves, run `gh pr update-branch`');
  }
  return { live, blockers, warnings };
}
