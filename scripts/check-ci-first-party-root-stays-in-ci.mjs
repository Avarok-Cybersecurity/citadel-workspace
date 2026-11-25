#!/usr/bin/env node
/**
 * The CI first-party root (the kernel's `ci-first-party-root` feature) is reachable from the
 * pull-request integration image only, never from a build that publishes or deploys. The rules
 * and why: scripts/lib/ci-first-party-root-rules.mjs. Reads every tracked text file.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciRootProblems } from './lib/ci-first-party-root-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// This gate and its rules name every name they police.
const SELF = new Set([
  'scripts/check-ci-first-party-root-stays-in-ci.mjs',
  'scripts/lib/ci-first-party-root-rules.mjs',
  'scripts/lib/ci-first-party-root-rules.test.mjs',
]);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0')
  .filter((p) => p !== '' && !SELF.has(p));
const files = new Map();
for (const path of tracked) {
  let bytes;
  try {
    bytes = readFileSync(join(ROOT, path));
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') continue; // a gitlink, or deleted in the worktree
    throw e;
  }
  if (bytes.includes(0)) continue; // binary
  files.set(path, bytes.toString('utf8'));
}
if (files.size < 1000) {
  console.error(`check-ci-first-party-root-stays-in-ci: only ${files.size} tracked text files read; run it from a full checkout.`);
  process.exit(1);
}

const problems = ciRootProblems(files);
if (problems.length > 0) {
  console.error('The CI first-party root could reach a build that ships:\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-ci-first-party-root-stays-in-ci: ${files.size} tracked text files read; the CI first-party root is reachable from the integration image only, and every publishing or deploying build is marked.`);
