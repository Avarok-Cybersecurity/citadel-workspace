/**
 * Every `actions/setup-node` step must restore the npm cache.
 *
 * This workflow installs a 1154-package tree. Uncached, `npm ci` at that size
 * costs 1-2 minutes against 20-40 seconds warm, and the workflow runs it in
 * dozens of jobs per push -- so roughly a runner-hour per push was being spent
 * re-downloading a tree that had not changed, and about a minute of it sat on
 * every job's critical path.
 *
 * `cache: npm` is one line and setup-node does the rest. Nothing had it.
 *
 * BOTH workflows. The parent's seven steps were fixed and the UI submodule's
 * five were not -- because this gate read only the parent's workflow directory,
 * so it reported 7 of 7 green while the repository where all UI work lands paid
 * the full uncached cost on every job. The same one-of-two-places shape as the
 * backend-log capture, found the same way: by a sweep, not by the gate.
 *
 * Read as TEXT rather than parsed. A gate that imports js-yaml can only run in
 * a job that installs dependencies (see check-gates-have-their-dependencies),
 * and this one should be runnable on a bare checkout like the workflow it
 * guards. The parse is deliberately shallow: find each `uses:` naming
 * setup-node, then read its `with:` block by indentation until the block ends.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Both workflow directories: this repository's, and the UI submodule's. */
const WORKFLOW_DIRS = [
  join(ROOT, '.github/workflows'),
  join(ROOT, 'citadel-workspaces/.github/workflows'),
];

/** Indentation width of a line, ignoring blank and comment-only lines. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

const problems = [];
let checked = 0;

/** `[label, absolute path]` for every workflow file in both directories. */
const files = [];
for (const dir of WORKFLOW_DIRS) {
  if (!existsSync(dir)) {
    console.error(
      `FAIL: ${dir} is missing.\n` +
        'Run from the parent checkout with submodules initialised. A gate that silently\n' +
        'examines one of the two workflows is exactly how the UI half went unfixed.',
    );
    process.exit(1);
  }
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    files.push([`${dir.includes('citadel-workspaces') ? 'citadel-workspaces/' : ''}${f}`, join(dir, f)]);
  }
}

if (files.length < 2) {
  console.error('FAIL: fewer than two workflow files found — this gate would pass by considering nothing.');
  process.exit(1);
}

for (const [file, path] of files) {
  const lines = readFileSync(path, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*(- )?uses:\s*actions\/setup-node@/.test(lines[i])) continue;
    checked += 1;

    // The step's own indentation. Its keys (`with:`) sit at that level or
    // deeper; the next line at or below it that is not part of this step ends
    // the step. `- uses:` starts a list item, so its keys align with `uses`.
    const stepIndent = indentOf(lines[i]) + (lines[i].trimStart().startsWith('- ') ? 2 : 0);

    let hasCache = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') continue;
      if (indentOf(line) < stepIndent) break; // dedented out of the step
      if (indentOf(line) === stepIndent && /^\s*-\s/.test(line)) break; // next step
      if (/^\s*cache:\s*npm\s*$/.test(line)) { hasCache = true; break; }
    }

    if (!hasCache) {
      problems.push(`${file}:${i + 1} — actions/setup-node without \`cache: npm\``);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=.github/workflows/${p.split(':')[0]}::${p}`);
  console.error(`\nFAIL: ${problems.length} of ${checked} setup-node step(s) do not restore the npm cache.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nAdd to the step\'s `with:` block:\n' +
      '    cache: npm\n' +
      '    cache-dependency-path: package-lock.json\n\n' +
      'Uncached `npm ci` over this 1154-package tree costs 1-2 min against\n' +
      '20-40s warm, in dozens of jobs per push.',
  );
  process.exit(1);
}

if (checked === 0) {
  console.error('FAIL: no actions/setup-node steps matched — the gate considered nothing.');
  process.exit(1);
}

console.log(`check-setup-node-restores-the-npm-cache: all ${checked} setup-node step(s) restore the npm cache.`);
