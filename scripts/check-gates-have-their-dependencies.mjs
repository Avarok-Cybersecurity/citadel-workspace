/**
 * A gate that imports a package must run in a job that installs one.
 *
 * Twice now a gate has been added to `crate-coverage`, which installs nothing
 * by design — every script it runs is dependency-free so the job stays fast.
 * Both times the whole job went red on `Cannot find package`, taking the other
 * twenty-five gates with it:
 *
 *   Cannot find package 'js-yaml' imported from check-service-logs-are-captured
 *   Cannot find package 'eslint'  imported from check-explicit-types
 *
 * A gate that cannot run is worth less than no gate, and one that takes
 * twenty-five others down with it is worse than that. So: if a gate imports
 * anything that is not a node: builtin or a relative path, the job that runs it
 * must install dependencies first.
 *
 * Read as text rather than parsed, for the same reason the gates it checks are:
 * this must run on a bare checkout.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = resolve(ROOT, '.github/workflows/validate.yml');

const INSTALLS = /npm (ci|install)\b/;
const GATE = /node\s+(scripts\/[a-z0-9-]+\.mjs)/g;
const BARE_IMPORT = /^\s*import\s[^'"]*from\s+['"]([^'".][^'"]*)['"]/gm;

const lines = readFileSync(WORKFLOW, 'utf-8').split('\n');

/** Job blocks: a two-space key whose block contains `runs-on:`. */
const blocks = [];
let current = null;
lines.forEach((line, index) => {
  const indent = line.length - line.trimStart().length;
  if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim())) {
    if (current) current.end = index;
    current = { name: line.trim().slice(0, -1), start: index, end: lines.length, isJob: false };
    blocks.push(current);
    return;
  }
  if (current && /^\s{4}runs-on:/.test(line)) current.isJob = true;
});

const jobs = blocks.filter((block) => block.isJob);
if (jobs.length < 5) {
  console.error(`\n  Found only ${jobs.length} job(s) — the workflow changed shape.\n`);
  process.exit(1);
}

/** Packages a gate imports, following its own relative imports one level. */
function packagesNeededBy(script, directory) {
  const path = join(ROOT, directory, script);
  if (!existsSync(path)) return [];
  // Comments stripped first. This gate's own doc comment contains the literal
  // `createRequire(...)('pkg')` as an example, and the first version of it read
  // that as an import and reported itself. A checker that cannot tell code from
  // the prose explaining the code will find prose everywhere.
  const source = readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const needed = new Set();
  for (const match of source.matchAll(BARE_IMPORT)) {
    if (!match[1].startsWith('node:')) needed.add(match[1]);
  }
  // `createRequire(...)('pkg')` is the other way in, and the one that made this
  // check necessary in the first place.
  for (const match of source.matchAll(/createRequire\([^)]*\)\(\s*['"]([^'"]+)['"]/g)) {
    if (!match[1].startsWith('node:')) needed.add(match[1]);
  }
  return [...needed];
}

const problems = [];
let checked = 0;

for (const job of jobs) {
  const body = lines.slice(job.start, job.end);
  const installsAt = body.findIndex((line) => INSTALLS.test(line));

  body.forEach((line, offset) => {
    for (const match of line.matchAll(GATE)) {
      const script = match[1];
      // The step's directory, from the lines around it.
      const window = body.slice(Math.max(0, offset - 6), offset + 4).join('\n');
      const directory = /working-directory:\s*(\S+)/.exec(window)?.[1] ?? '.';
      const needed = packagesNeededBy(script, directory);
      if (needed.length === 0) return;
      checked += 1;
      if (installsAt === -1 || installsAt > offset) {
        problems.push(
          `${job.name}: ${script} imports ${needed.join(', ')} and the job ` +
            (installsAt === -1 ? 'installs nothing' : 'installs afterwards'),
        );
      }
    }
  });
}

if (checked === 0) {
  console.error('\n  No gate imports a package — this check is measuring nothing.\n');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('\n  Gates that cannot run where they are:\n');
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  ${checked} gate(s) with dependencies run where those exist  ok`);
