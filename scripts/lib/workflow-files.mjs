/**
 * Reads .github/required-checks.json and a repository's workflow files: the I/O half shared by
 * scripts/check-workflow-graph.mjs and scripts/merge-blockability.mjs (lib/workflow-graph.mjs
 * judges what this returns). Fails on a missing key or directory rather than measuring nothing.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG = '.github/required-checks.json';

export function loadConfig() {
  const config = JSON.parse(readFileSync(join(ROOT, CONFIG), 'utf8'));
  return {
    config,
    need(key) {
      if (config[key] === undefined) throw new Error(`${CONFIG} has no "${key}"`);
      return config[key];
    },
  };
}

/** One repository's workflows, and how its `uses: ./...` resolve (against that repository's root). */
export function repoWorkflows(dir) {
  const path = join(ROOT, dir);
  if (!existsSync(path)) throw new Error(`${dir} does not exist (submodules not checked out?); nothing was measured there`);
  const files = readdirSync(path).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (files.length === 0) throw new Error(`${dir} holds no workflow; nothing was measured there`);
  const repoRoot = join(path, '..', '..');
  return {
    repoRoot,
    workflows: files.map((f) => ({ path: `${dir}/${f}`, text: readFileSync(join(path, f), 'utf8') })),
    readCallee: (uses) => readFileSync(join(repoRoot, uses), 'utf8'),
  };
}
