#!/usr/bin/env node
/**
 * Every value production REQUIRES from `.env` must be in `.env.example`.
 *
 * `docker-compose.production.yml` distinguishes two forms, and the difference
 * is the whole check:
 *
 *   ${IMAGE_TAG:-latest}                  has a default; unset is fine
 *   ${INTERNAL_SERVICE_ALLOWED_ORIGINS}   no default; unset means empty
 *
 * The second form is a value the operator must supply. One of them —
 * INTERNAL_SERVICE_ALLOWED_ORIGINS, the WebSocket origin allowlist that decides
 * which pages may drive an agent that can enumerate every account and act as
 * them — appeared in three compose files, the CI workflow and main.rs, and in
 * no .md file and not in .env.example. The service refuses to start without it,
 * which is correct, so the operator met a hard failure with nothing to consult.
 *
 * Fail-closed behaviour and documented behaviour are different properties. This
 * checks the second, which nothing else did.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(ROOT, 'docker-compose.production.yml');
const EXAMPLE = join(ROOT, '.env.example');

const compose = readFileSync(COMPOSE, 'utf8');
const example = readFileSync(EXAMPLE, 'utf8');

// `${VAR}` only. `${VAR:-default}` supplies its own value and is not required.
const required = [...new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]))];

if (required.length === 0) {
  console.error(
    'No required ${VAR} substitutions found in docker-compose.production.yml — ' +
      'this check verified nothing. Did the file move, or the syntax change?',
  );
  process.exit(1);
}

// A commented-out line still documents the variable, which is the right shape
// for one whose correct state is "unset" (WORKSPACE_ALLOW_SCHEMA_DOWNGRADE).
const documented = new Set(
  [...example.matchAll(/^[#\s]*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const missing = required.filter((name) => !documented.has(name));

if (missing.length > 0) {
  console.error('These are REQUIRED by docker-compose.production.yml but absent from .env.example:\n');
  for (const name of missing) console.error(`  - ${name}`);
  console.error(
    '\nEach is `${NAME}` with no default, so an operator who does not set it gets\n' +
      'an empty value. Document it in .env.example, with what happens if it is\n' +
      'wrong — a value the deployment cannot start without deserves a sentence.',
  );
  process.exit(1);
}

console.log(
  `Required env OK: ${required.length} value(s) required by production compose, all documented.`,
);
