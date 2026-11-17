/**
 * A gate that rewrites its own baseline, left uncommitted, stops being a gate.
 *
 * Three checks here ratchet against a baseline file and REWRITE that file in
 * the working tree when the count improves, then exit 1 asking for the new
 * count to be committed. That works exactly once. The first local run fails
 * loudly; every run after it compares against the rewritten file and passes,
 * while CI keeps comparing against the committed one and keeps failing.
 *
 * It has happened three times in this tree. The last was round 455: a spec
 * swapped a copy-addressed press for a testid, 132 became 131, the baseline was
 * rewritten and never staged, and the local preflight said "all checks passed"
 * for three more rounds while CI failed on it.
 *
 * The leftover is mechanically visible -- a tracked baseline with unstaged
 * changes -- so this reports it as its own failure instead of leaving it to be
 * discovered in a red run. In CI the checkout is clean, so this passes unless a
 * gate actually rewrote something, which is the same condition.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '..');

// The baselines are discovered, not listed. A list here would be a second copy
// of a fact the filenames already carry, and the next self-writing gate would
// be added without it.
const baselines = readdirSync(scriptsDir)
  .filter((f) => f.endsWith('.baseline.json'))
  .map((f) => `scripts/${f}`)
  .sort();

if (baselines.length === 0) {
  console.error('  Baselines committed: no *.baseline.json found under scripts/ -- has this check gone stale?  FAIL');
  process.exit(1);
}

const git = (args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

// Judged against the INDEX, not HEAD: the index is what the commit will hold.
// Against HEAD, the pre-commit hook failed every commit that staged its
// rewritten baseline -- the very fix this asks for -- so the only way past it
// was --no-verify. In CI the index is the checkout, so the two are the same.
// A rewrite left unstaged shows here; so must a baseline never committed at
// all, which git cannot diff -- precisely the state a brand-new ratcheting gate
// leaves behind. This check reported "all 4 match HEAD" over an untracked file
// on the day it was written, which is the failure mode it exists to catch.
const modified = git(['diff', '--name-only', '--', ...baselines])
  .split('\n')
  .filter(Boolean);

const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...baselines])
  .split('\n')
  .filter(Boolean);

const dirty = [...new Set([...modified, ...untracked])].sort();

if (dirty.length > 0) {
  console.error(
    `  Baselines committed: ${dirty.length} ratcheting baseline(s) differ from what is staged  FAIL`,
  );
  for (const file of dirty) {
    if (untracked.includes(file)) {
      console.error(`    ${file}  (never committed -- git has no record of it at all)`);
      continue;
    }
    const staged = git(['show', `:${file}`]);
    const changed = existsSync(resolve(repoRoot, file))
      ? git(['diff', '--numstat', '--', file])
      : '(deleted)';
    console.error(`    ${file}  (${changed.split('\t').slice(0, 2).join(' +/- ')} lines, the staged copy has ${staged.length} bytes)`);
  }
  console.error('');
  console.error('  A gate wrote its baseline in the working tree and it is not in the commit.');
  console.error('  Local runs now compare against that file and pass; CI compares against the');
  console.error('  commit and fails. Commit the baseline as part of the change that made it.');
  process.exit(1);
}

console.log(
  `  Baselines committed: all ${baselines.length} ratcheting baseline(s) match what is staged  ok`,
);
