#!/usr/bin/env node
/**
 * Fails if the stack REQUIRES configuration the quickstart never tells you to create.
 *
 * The two existing doc gates both run in the same direction: a doc names a
 * command (check-doc-commands.mjs) or an env var (check-doc-env-vars.sh), and
 * the gate proves the repo backs it. Both were green while `README.md`'s
 * quickstart — clone, `npm ci`, `docker compose up` — could not work on a clean
 * clone at all: docker-compose.yml interpolates `${WORKSPACE_MASTER_PASSWORD}`
 * with no `:-` fallback, so a checkout with no `.env` resolves it to "" and the
 * server exits with "workspace_master_password is required".
 *
 * Nothing was wrong with any sentence in the README. The defect was a missing
 * one, which is invisible to a gate that only validates the sentences present.
 *
 * The rule: if a compose file the docs tell you to run has any variable with no
 * default, then (a) `.env.example` must define it, and (b) the doc must tell you
 * to create `.env` BEFORE the compose command that needs it. Ordering is part of
 * the contract — a `cp` step further down the page is a step a reader has
 * already walked past.
 *
 * Pure file reads: no toolchain, no Docker, no network.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = 'docker-compose.yml';
const ENV_EXAMPLE = '.env.example';
const DOCS = ['README.md'];

const failures = [];

/** Variables the compose file needs from the environment, with no `:-` fallback. */
function requiredVars(file) {
  const found = new Set();
  for (const raw of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
    // Strip comments: a `${VAR}` inside a YAML comment documents syntax, it
    // does not get interpolated. docker-compose.yml line 125 is exactly that.
    const line = raw.replace(/#.*$/, '');
    for (const m of line.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g)) {
      if (!m[2]) found.add(m[1]);
    }
  }
  return found;
}

const required = requiredVars(COMPOSE);
if (required.size === 0) {
  console.log(`check-doc-setup-steps: ${COMPOSE} has no undefaulted variables; nothing to document.`);
  process.exit(0);
}

// (a) .env.example must define every required variable.
const envExample = existsSync(join(ROOT, ENV_EXAMPLE))
  ? readFileSync(join(ROOT, ENV_EXAMPLE), 'utf8')
  : '';
for (const v of required) {
  if (!new RegExp(`^\\s*${v}=`, 'm').test(envExample)) {
    failures.push(`${ENV_EXAMPLE} does not define \`${v}\`, which ${COMPOSE} requires with no default.`);
  }
}

// (b) each doc running compose must bootstrap .env first.
for (const doc of DOCS) {
  const path = join(ROOT, doc);
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, 'utf8').split('\n');

  const upAt = lines.findIndex((l) => /^\s*docker\s+compose\b.*\bup\b/.test(l));
  if (upAt === -1) continue; // doc does not start the stack

  const cpAt = lines.findIndex((l) => /\bcp\s+\.env\.example\s+\.env\b/.test(l));
  if (cpAt === -1) {
    failures.push(
      `${doc}:${upAt + 1} runs \`docker compose up\` but the doc never says to create \`.env\`. ` +
        `On a clean clone ${[...required].join(', ')} ${required.size === 1 ? 'resolves' : 'resolve'} to "" and the server refuses to start.`,
    );
  } else if (cpAt > upAt) {
    failures.push(
      `${doc}: \`cp .env.example .env\` is at line ${cpAt + 1}, AFTER \`docker compose up\` at line ${upAt + 1}. ` +
        `A reader following the doc top-to-bottom starts the stack before the config exists.`,
    );
  }
}

if (failures.length > 0) {
  console.error('check-doc-setup-steps: the quickstart cannot work on a clean clone.\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.log(
  `check-doc-setup-steps: OK — ${required.size} required var(s) documented and bootstrapped before use.`,
);
