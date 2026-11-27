/**
 * The pre-push judgement's reads, for preflight.mjs: is the checkout what is pushed, and in verify
 * mode, has every check this push needs already passed over these inputs. Decisions: preflight-push.mjs.
 */
import { execFileSync } from 'node:child_process';
import { checkoutProblem, unstampedChecks, verifyFailure } from './preflight-push.mjs';
import { lastWorld } from './preflight-stamp-io.mjs';
import { REPO_LOCATORS, worldDifferences } from './preflight-stamp.mjs';

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_LOCATORS.includes(k)));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** HEAD, and the tracked paths (submodule pointers and dirty submodules included) that differ from it. */
export function headAndTrackedChanges(root) {
  git(root, 'update-index', '-q', '--refresh');
  const head = git(root, 'rev-parse', 'HEAD').trim();
  const trackedChanges = git(root, 'diff-index', '--name-only', 'HEAD').split('\n').filter(Boolean);
  return { head, trackedChanges };
}

/** Exits 1 with the reason when the push may not go; returns when it may (or, in run mode, when the tier may run). */
export function judgePush({ root, refs, mode, stamps, stampDir }) {
  const problem = checkoutProblem({ refs, ...headAndTrackedChanges(root) });
  if (problem) {
    console.error(`\npre-push: ${problem}`);
    process.exit(1);
  }
  if (mode !== 'verify') return;
  const missing = stamps.off ? stamps.plan.map((p) => p.check.name) : unstampedChecks(stamps.plan);
  if (missing.length === 0) return;
  const last = lastWorld(stampDir, root);
  const differences = last && stamps.world ? worldDifferences(last, stamps.world.entries, 8) : [];
  console.error(verifyFailure({ missing, differences, off: stamps.off }));
  process.exit(1);
}
