/**
 * The gates preflight derives from validate.yml, as hook checks: each with the change tiers it
 * belongs to and what decides its relevance to a change (lib/change-tiers.mjs). One place, so the
 * hooks and the test that proves pre-push covers everything pre-commit leaves out read one list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readsWholeRepo } from './change-tiers.mjs';
import { NOT_ON_PRE_COMMIT, derivedChecks, gateKey } from './preflight-plan.mjs';
import { scriptDrivesABrowser } from './preflight-stamp-io.mjs';

/** @param {string} root @returns {{ checks: object[], skipped: [string, string][] }} throws when the workflow cannot be read */
export function derivedHookChecks(root) {
  const plan = derivedChecks(root);
  const checks = plan.checks.map((c) => {
    const ui = c.area === 'citadel-workspaces' || c.area === 'citadel-workspace-client-ts';
    if (c.kind === 'heavy') return { ...c, tiers: new Set() };
    const source = c.script ? readFileSync(join(root, c.script), 'utf8') : '';
    // A gate that drives a browser or a built bundle waits for pre-push (stamped) and CI: on a
    // commit they cost ~690 of 707 s, and 7 of them judged a dist/ nothing rebuilds for a commit.
    const browser = c.script !== null && scriptDrivesABrowser(root, c.script);
    const slow = NOT_ON_PRE_COMMIT.has(gateKey([c.cmd, ...c.args])) || browser;
    return {
      ...c,
      tiers: new Set([ui ? 'ui' : 'parent', ...(slow ? ['not-pre-commit'] : [])]),
      relevance: { script: c.script, source, cwdArea: c.area, wholeRepo: readsWholeRepo(source), browser },
    };
  });
  return { checks, skipped: plan.skipped };
}
