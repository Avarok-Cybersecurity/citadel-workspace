/**
 * The pre-push hook's two modes, decided. Pure; preflight.mjs and pre-push-tier.mjs do the reads.
 *
 * git opens the connection to the remote BEFORE it runs pre-push and holds it idle for the whole
 * hook (GIT_TRACE, REL-1124: ssh started 0.8 s before the hook and was alive inside it). GitHub
 * drops an idle SSH session after minutes; a 13-46 minute tier lost more than ten pushes that way.
 * So inside `git push` the hook never runs the tier: it VERIFIES that every check the push needs
 * already passed over exactly these inputs, and otherwise fails in seconds naming the command.
 * That command runs the hook itself (`git hook run pre-push`) in RUN mode, with no connection
 * open, in the environment git gives hooks, so its stamps are the ones the push looks for.
 */

/** The one command that runs exactly what the pre-push hook judges, for the branch checked out. */
export const PRE_PUSH_COMMAND = 'node scripts/pre-push-tier.mjs --remote origin';

/** @param {string|undefined} value PREFLIGHT_PRE_PUSH @returns {'verify'|'run'} */
export function pushMode(value) {
  if (value === undefined) return 'verify';
  if (value === 'run') return 'run';
  throw new Error(`PREFLIGHT_PRE_PUSH is '${value}'; only ${PRE_PUSH_COMMAND} sets it (to 'run')`);
}

/**
 * Why the checkout cannot stand for what is pushed, or null. The tier judges the working tree;
 * the push sends commits. They are the same thing only when every pushed ref is HEAD and no
 * tracked file differs from HEAD. (Untracked files are in the key, so they can only cause a re-run.)
 * @param {{ refs: { localRef: string, localSha: string }[], head: string, trackedChanges: string[] }} input
 * @returns {string|null}
 */
export function checkoutProblem({ refs, head, trackedChanges }) {
  const elsewhere = refs.filter((r) => !/^0+$/.test(r.localSha) && r.localSha !== head);
  if (elsewhere.length > 0) {
    return `this push sends ${elsewhere.map((r) => `${r.localRef} (${r.localSha.slice(0, 10)})`).join(', ')}, but the checkout is at ${head.slice(0, 10)}.\n` +
      '  The tier judges the checkout, so it can only vouch for HEAD: check out what you push, or push the branch you are on.';
  }
  if (trackedChanges.length > 0) {
    const shown = trackedChanges.slice(0, 5).join(', ') + (trackedChanges.length > 5 ? `, … (${trackedChanges.length})` : '');
    return `tracked files differ from HEAD (${shown}).\n  The tier would judge them, the push would not send them: commit or stash them first.`;
  }
  return null;
}

/** Why a hand run without git's refs is refused: it would judge nothing and say "passed". */
export function noRefsMessage() {
  return 'preflight: --tier pre-push got no refs on stdin. Git feeds them to the hook; a hand run has none,\n' +
    '  so it would select nothing and report a pass (REL-1124: 2 s, then the real push ran 888 s).\n' +
    `  To run exactly what the hook will judge for this branch: ${PRE_PUSH_COMMAND}`;
}

/**
 * The verify-mode verdict: the checks with no stamp for these inputs.
 * @param {{ check: { name: string }, key: string|null, decision: { run: boolean } }[]} plan
 * @returns {string[]} names; empty means the push may go
 */
export function unstampedChecks(plan) {
  return plan.filter((p) => p.key !== null && p.decision.run).map((p) => p.check.name);
}

/** The message a push gets when it may not go yet. */
export function verifyFailure({ missing, differences, off }) {
  const lines = [`\npre-push: ${missing.length} check(s) this push needs have not passed over these exact inputs:`];
  for (const name of missing.slice(0, 12)) lines.push(`  - ${name}`);
  if (missing.length > 12) lines.push(`  … and ${missing.length - 12} more`);
  if (off) lines.push(`(stamps are off for this run: ${off})`);
  if (differences.length > 0) lines.push(`What differs from the last tier run in this checkout: ${differences.join(', ')}`);
  lines.push('', 'Nothing was pushed and no connection is held. Run the tier (it waits for the machine-wide hook lock):',
    `  ${PRE_PUSH_COMMAND}`, 'then push again: the hook then only verifies, in seconds.');
  return lines.join('\n');
}
