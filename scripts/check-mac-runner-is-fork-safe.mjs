#!/usr/bin/env node
/**
 * No fork's pull request can run on the self-hosted Mac runners.
 *
 * Every repository here is public, and the Mac (`apple-48gb-metal`) keeps its
 * state between jobs. A job may name that pool only through the one runs-on
 * expression in scripts/lib/mac-runner-routing.mjs: opt-in variable, same-repo
 * guard, pool array, hosted fallback. Anything else that names it -- a bare
 * label list, a matrix value, a guard that was reflowed into a weaker one, a
 * trigger the guard cannot reason about -- fails here, before a fork tries it.
 *
 * Covers this repository's workflows and the UI submodule's, because the UI's
 * CI runs this script from its parent checkout. The submodule directory is
 * required: a scan root that is silently absent reports safety it never checked.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from './lib/mac-runner-routing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIRS = ['.github/workflows', 'citadel-workspaces/.github/workflows'];

const problems = [];
let jobs = 0;
let files = 0;
const routed = [];
for (const dir of WORKFLOW_DIRS) {
  const path = join(ROOT, dir);
  if (!existsSync(path)) {
    problems.push(`${dir} does not exist; initialise submodules, or this check measured nothing there`);
    continue;
  }
  const workflows = readdirSync(path)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((name) => ({ name, source: readFileSync(join(path, name), 'utf8') }));
  files += workflows.length;
  const result = judge(workflows);
  jobs += result.jobs;
  problems.push(...result.problems.map((p) => `${dir}/${p}`));
  routed.push(...result.routed.map((r) => `${dir}/${r}`));
}

if (jobs === 0) problems.push('no jobs found in any workflow; the parser no longer matches the files');

if (problems.length) {
  console.error('\n  A job could put untrusted code on the self-hosted Mac:\n');
  for (const p of problems) console.error(`::error::${p}`);
  console.error('\n  Route a job there only with the expression in scripts/lib/mac-runner-routing.mjs.\n');
  process.exit(1);
}
console.log(`  Mac runner fork guard: ${jobs} job(s) in ${files} workflow(s), ${routed.length} routed to the Mac, every one guarded  ok`);
