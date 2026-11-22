#!/usr/bin/env node
/**
 * Every agent build verifies the certificate it compiles in, against an explicit floor: 30 days
 * for a published build, 0 (valid now) for a dry run or a PR's agent legs. The rules, and the
 * dry run that failed a month early (run 44941697947), are in lib/certificate-coverage.mjs.
 *
 *   node scripts/check-agent-certificate-is-verified.mjs
 *
 * Reads the root workflows and every local action; a missing directory is a failure.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { certificateGaps } from './lib/certificate-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = '.github/workflows';
const ACTIONS = '.github/actions';

function dir(path) {
  if (!existsSync(join(ROOT, path))) {
    console.error(`::error::${path} does not exist; nothing was checked`);
    process.exit(1);
  }
  return readdirSync(join(ROOT, path));
}

const workflows = dir(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ path: `${WORKFLOWS}/${f}`, text: readFileSync(join(ROOT, WORKFLOWS, f), 'utf8') }));
const actions = Object.fromEntries(
  dir(ACTIONS)
    .filter((name) => existsSync(join(ROOT, ACTIONS, name, 'action.yml')))
    .map((name) => [name, readFileSync(join(ROOT, ACTIONS, name, 'action.yml'), 'utf8')]),
);

const { problems, builds, uses } = certificateGaps({ workflows, actions });
if (builds === 0 || uses === 0) problems.push(`found ${builds} agent builds and ${uses} certificate issuers; the layout moved, so this measured nothing`);
if (problems.length > 0) {
  console.error('\n  An agent build does not verify the certificate it compiles in:\n');
  for (const p of problems) console.error(`::error::${p}`);
  console.error('');
  process.exit(1);
}
console.log(
  `  Agent certificate: ${builds} agent-building jobs across ${workflows.length} workflows verify it, ` +
    `${uses} issuer(s) pass an explicit floor  ok`,
);
