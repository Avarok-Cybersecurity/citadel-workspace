#!/usr/bin/env node
/**
 * Every `npm run X` in the workflow must name a script that exists where it runs.
 *
 * A gate was added to validate.yml without the `working-directory:
 * citadel-workspaces` its four neighbours carry, so it ran from the repo root
 * and died on `npm error Missing script: "check:a11y"` — after a Docker build,
 * a WASM sync and three browser checks had already run. Twenty minutes of CI to
 * discover a missing line that is visible in the diff.
 *
 * The mistake is easy because the directory is a property of each STEP here,
 * not of the job: a step copied from the wrong neighbour, or written fresh,
 * silently inherits the root.
 *
 * The rule is precise rather than blanket — not "every npm step must declare a
 * directory", which would be false for genuine root scripts, but "the script
 * must exist in the package.json of the directory the step actually runs in".
 *
 * Pure file reads: no browser, no toolchain, no network.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'validate.yml');

if (!existsSync(WORKFLOW)) {
  // A guard that cannot find what it guards has verified nothing.
  console.error('check-workflow-npm-scripts-exist: validate.yml is missing, so nothing was checked.');
  process.exit(1);
}

const lines = readFileSync(WORKFLOW, 'utf8').split('\n');

/** `npm run <script>` invocations, with the directory the step declares. */
const steps = [];
for (const [index, line] of lines.entries()) {
  const run = /^\s*run:\s*npm run ([a-z0-9:_-]+)/.exec(line);
  if (!run) continue;

  // `working-directory` may sit before or after `run:` within the same step.
  // Walk out to the step boundary in both directions rather than assuming an
  // order, because both orders appear in this file.
  const indent = /^(\s*)/.exec(line)[1].length;
  let dir = '.';
  for (const step of [-1, 1]) {
    for (let i = index + step; i >= 0 && i < lines.length; i += step) {
      const current = lines[i];
      if (current.trim() === '') continue;
      const currentIndent = /^(\s*)/.exec(current)[1].length;
      // A new list item at or below this indentation ends the step.
      if (/^\s*- /.test(current) && currentIndent <= indent) break;
      if (currentIndent < indent) break;
      const wd = /^\s*working-directory:\s*(\S+)/.exec(current);
      if (wd) { dir = wd[1]; break; }
    }
    if (dir !== '.') break;
  }

  steps.push({ line: index + 1, script: run[1], dir });
}

if (steps.length < 5) {
  console.error(
    `check-workflow-npm-scripts-exist: only ${steps.length} npm steps found — ` +
      'the workflow moved or changed shape, so this list cannot be trusted.',
  );
  process.exit(1);
}

const manifests = new Map();
function scriptsIn(dir) {
  if (!manifests.has(dir)) {
    const path = join(ROOT, dir, 'package.json');
    manifests.set(dir, existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).scripts ?? {} : null);
  }
  return manifests.get(dir);
}

const failures = [];
for (const { line, script, dir } of steps) {
  const available = scriptsIn(dir);
  if (available === null) {
    failures.push(`validate.yml:${line} — working-directory "${dir}" has no package.json`);
    continue;
  }
  if (!(script in available)) {
    const where = dir === '.' ? 'the repo root' : dir;
    failures.push(
      `validate.yml:${line} — "npm run ${script}" runs in ${where}, which has no such script`,
    );
  }
}

if (failures.length > 0) {
  console.error('\ncheck-workflow-npm-scripts-exist: steps that cannot run:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`check-workflow-npm-scripts-exist: OK — ${steps.length} npm steps name a script that exists.`);
