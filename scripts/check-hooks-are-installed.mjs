#!/usr/bin/env node
/**
 * This clone, and every submodule that tracks hooks, has them switched on.
 *
 * About 190 of 344 CI failures in thirty days were gates preflight already runs -- fmt, clippy,
 * file length, own-code type errors -- that nobody ran before pushing. A tracked hook does
 * nothing until `core.hooksPath` points at it, and git says nothing when it does not: the parent
 * documented `git config core.hooksPath .githooks` and nobody had run it, so its pre-push hook
 * had never fired once. The UI repo had no hooks at all.
 *
 * The parent's root `prepare` script installs both (npm runs it on install); the UI's own
 * `prepare` installs its hooks in a standalone clone. Git also silently skips a hook that is not
 * executable, so the mode is checked too.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = '.githooks';

const hooksPath = (repo) => {
  try {
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

const submodules = readFileSync(join(ROOT, '.gitmodules'), 'utf8')
  .split('\n')
  .map((line) => /^\s*path\s*=\s*(\S+)/.exec(line)?.[1])
  .filter(Boolean);

const repos = ['.', ...submodules].filter((repo) => existsSync(join(ROOT, repo, HOOKS)));
if (!repos.includes('.') || !repos.includes('citadel-workspaces')) {
  console.error(`FAIL: expected tracked ${HOOKS}/ in the parent and in citadel-workspaces; found it in: ${repos.join(', ') || 'none'}.`);
  process.exit(1);
}

const problems = [];
let examined = 0;
for (const repo of repos) {
  const dir = join(ROOT, repo);
  const configured = hooksPath(dir);
  if (configured !== HOOKS) {
    problems.push(`${repo}: core.hooksPath is ${configured ? `'${configured}'` : 'unset'}, so its tracked hooks never run.\n` +
      `      fix: npm install (the root prepare script sets it), or: git -C ${repo} config core.hooksPath ${HOOKS}`);
  }
  for (const hook of readdirSync(join(dir, HOOKS))) {
    examined += 1;
    if ((statSync(join(dir, HOOKS, hook)).mode & 0o111) === 0) {
      problems.push(`${repo}/${HOOKS}/${hook} is not executable, and git skips it without a word.\n      fix: chmod +x ${repo}/${HOOKS}/${hook} and commit the mode`);
    }
  }
}

if (problems.length > 0) {
  console.error('Hooks are not installed:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nThe escape hatch for one commit or push is `--no-verify`; there is no other.');
  process.exit(1);
}
console.log(`Hooks installed: ${repos.join(', ')} (${examined} hook files, all executable).`);
