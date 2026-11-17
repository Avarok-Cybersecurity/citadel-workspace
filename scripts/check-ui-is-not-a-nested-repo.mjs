#!/usr/bin/env node
/**
 * citadel-workspaces/ belongs to this repository, not to a nested one.
 *
 * The UI was a submodule until it was folded into plain files. The persistent Mac runners kept
 * the submodule's gitfile (`citadel-workspaces/.git`, `gitdir: ../.git/modules/citadel-workspaces`)
 * and the module directory it points at, because `actions/checkout` with `clean: true` removes
 * neither. Every git command run with its cwd inside the UI then resolved to that dead repository:
 * `git ls-files src` listed 3995 stale paths and none of the files added since the fold, so each
 * UI gate that enumerates files with git judged a frozen snapshot and passed on code it never saw.
 *
 * The cleanup lives in .github/actions/no-nested-ui-repo, which runs this gate after removing the
 * leftovers. Here the condition itself is asserted: the UI's git toplevel is this repository's,
 * and there is no `.git` entry of any kind inside the UI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = 'citadel-workspaces';

const toplevel = (cwd) =>
  realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim());

if (!existsSync(join(ROOT, UI))) {
  console.error(`check-ui-is-not-a-nested-repo: ${UI}/ is missing, so nothing was checked.`);
  process.exit(1);
}

const repoRoot = toplevel(ROOT);
const uiRoot = toplevel(join(ROOT, UI));
const marker = join(ROOT, UI, '.git');
const markerKind = existsSync(marker) ? (lstatSync(marker).isDirectory() ? 'directory' : 'file') : null;

const problems = [];
if (uiRoot !== repoRoot) {
  problems.push(`git inside ${UI}/ resolves to ${uiRoot}, not this repository (${repoRoot}).`);
}
if (markerKind) {
  problems.push(`${UI}/.git exists (a ${markerKind}): a nested repository shadows the tracked UI files.`);
}

if (problems.length > 0) {
  console.error('FAIL: the UI is a nested git repository, so every git-listing UI gate reads the wrong tree.');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`  fix: rm ${UI}/.git (if a gitfile) and rm -rf "$(git rev-parse --git-common-dir)/modules/${UI}";`);
  console.error('       a real nested clone must be moved out of the tree by hand.');
  process.exit(1);
}
console.log(`ok: git in ${UI}/ resolves to ${uiRoot}, the repository root; ${UI}/.git: absent.`);
