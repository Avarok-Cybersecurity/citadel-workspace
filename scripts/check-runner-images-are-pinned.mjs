#!/usr/bin/env node
/**
 * No job runs on `ubuntu-latest`; every hosted Linux runner names its release.
 *
 * GitHub moves `ubuntu-latest` to a new release on its own schedule. On
 * 2026-11-15 it moved to 26.04, Playwright 1.59 refused to install Chromium
 * there, and every browser job in every repository went red at once with no
 * change of ours. A named release (`ubuntu-24.04`) moves only when we move it,
 * together with whatever has to follow (Playwright, the geometry baselines).
 *
 * Reach: the parent's and the UI submodule's workflows, Linux only. The agent
 * repository pins its own; `macos-latest` and `windows-latest` are not judged.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIRS = ['.github/workflows', 'citadel-workspaces/.github/workflows'];
const FLOATING = /ubuntu-latest/;

const problems = [];
let files = 0;
for (const dir of WORKFLOW_DIRS) {
  const path = join(ROOT, dir);
  if (!existsSync(path)) {
    problems.push(`${dir} does not exist; initialise submodules, or this check measured nothing there`);
    continue;
  }
  for (const name of readdirSync(path).filter((f) => /\.ya?ml$/.test(f))) {
    files += 1;
    readFileSync(join(path, name), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      if (FLOATING.test(line)) problems.push(`${dir}/${name}:${i + 1}: ${line.trim()}`);
    });
  }
}

if (files === 0) problems.push('no workflow files found; this check measured nothing');

if (problems.length) {
  console.error('\n  A job runs on a runner image GitHub can change under us:\n');
  for (const p of problems) console.error(`::error::${p}`);
  console.error('\n  Name the release, e.g. ubuntu-24.04.\n');
  process.exit(1);
}
console.log(`  Runner images: ${files} workflow(s), every Linux runner pinned to a release  ok`);
