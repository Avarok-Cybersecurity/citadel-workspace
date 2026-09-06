/**
 * The Node floor must be enforced, not merely declared.
 *
 * `engines: { node: ">=20" }` is advisory: npm installs on Node 18 without a
 * word. The build then runs most of the way and dies inside a transitive
 * dependency with `ReferenceError: crypto is not defined` — the Web Crypto
 * global Node added in 19 — and because the stack trace passes through
 * `@rollup/plugin-terser`, it reads as a missing terser dependency rather than
 * a wrong runtime. README.md has described this failure for some time; nothing
 * stopped it happening.
 *
 * Three things must agree, and this checks all three, because any two agreeing
 * while the third drifts is how the floor stops meaning anything:
 *
 *   - package.json `engines.node` declares the floor;
 *   - .npmrc sets `engine-strict=true`, so npm refuses instead of warning;
 *   - .nvmrc names a version that satisfies the floor, so `nvm use` lands on
 *     a runtime that will actually install.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const pkgPath = join(ROOT, 'package.json');
if (!existsSync(pkgPath)) {
  console.error('FAIL: no package.json at the repo root — nothing to check.');
  process.exit(1);
}

const engines = JSON.parse(readFileSync(pkgPath, 'utf8')).engines ?? {};
const declared = engines.node;
if (!declared) {
  problems.push('package.json declares no `engines.node`, so there is no floor to enforce');
}

/** The major version a `>=N` style range floors at. */
const floor = declared ? Number((declared.match(/(\d+)/) ?? [])[1]) : NaN;
if (declared && !Number.isFinite(floor)) {
  problems.push(`package.json engines.node is ${JSON.stringify(declared)}, which names no major version`);
}

const npmrcPath = join(ROOT, '.npmrc');
if (!existsSync(npmrcPath)) {
  problems.push('no .npmrc — without `engine-strict=true` npm installs on any Node and says nothing');
} else if (!/^\s*engine-strict\s*=\s*true\s*$/m.test(readFileSync(npmrcPath, 'utf8'))) {
  problems.push('.npmrc does not set `engine-strict=true`, so `engines` stays advisory');
}

const nvmrcPath = join(ROOT, '.nvmrc');
if (!existsSync(nvmrcPath)) {
  problems.push('no .nvmrc — nothing tells a contributor which Node to switch to');
} else if (Number.isFinite(floor)) {
  const pinned = Number((readFileSync(nvmrcPath, 'utf8').match(/(\d+)/) ?? [])[1]);
  if (!Number.isFinite(pinned)) {
    problems.push('.nvmrc names no version');
  } else if (pinned < floor) {
    problems.push(`.nvmrc pins Node ${pinned}, below the engines floor of ${floor} — following it produces the failure the floor exists to prevent`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=package.json::${p}`);
  console.error(`\nFAIL: the Node floor is not enforced.\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-node-floor-is-enforced: engines "${declared}", .npmrc engine-strict, ` +
    `.nvmrc ${readFileSync(nvmrcPath, 'utf8').trim()} — all three agree.`,
);
