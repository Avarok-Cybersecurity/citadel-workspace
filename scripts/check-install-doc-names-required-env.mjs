#!/usr/bin/env node
// `docker compose -f docker-compose.production.yml up -d --wait` fails with no
// useful message when a variable that has no default is unset: the container
// starts, the binary exits, and `--wait` reports a timeout. So every such
// variable has to be named in the install doc, or the quickstart cannot be
// completed by anyone reading it.
//
// This existed: INSTALL.md named WORKSPACE_MASTER_PASSWORD and called the rest
// optional. INTERNAL_SERVICE_ALLOWED_ORIGINS also has no default, and
// citadel-workspace-internal-service exits at startup without it -- so the
// documented quickstart could not bring the stack up.
//
// The required set is DERIVED from compose (`${VAR}` with no `:-` default),
// never listed here, so a new required variable is a failure until documented.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = 'docker-compose.production.yml';
const DOC = 'docs/INSTALL.md';

const compose = readFileSync(join(root, COMPOSE), 'utf8');

// `${VAR}` is required; `${VAR:-fallback}` and `${VAR-fallback}` are not.
const required = new Set();
for (const [, name] of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)) required.add(name);
for (const [, name] of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)[:-]/g)) required.delete(name);

if (required.size === 0) {
  throw new Error(`no required \${VAR} found in ${COMPOSE} -- the pattern must have changed`);
}

const doc = readFileSync(join(root, DOC), 'utf8');
const missing = [...required].filter((name) => !doc.includes(name));

if (missing.length) {
  console.error(`${DOC} does not name every variable ${COMPOSE} requires:\n`);
  for (const name of missing) {
    console.error(
      `  ${name}  -- used with no default, so the stack cannot start without ` +
        `it,\n      and the doc never tells the reader to set it.`,
    );
  }
  console.error(
    `\nEither document it in ${DOC}, or give it a \`\${${missing[0]}:-default}\` ` +
      `in ${COMPOSE}\nif a default is genuinely safe.`,
  );
  process.exit(1);
}

console.log(
  `OK: ${DOC} names all ${required.size} variables ${COMPOSE} requires ` +
    `(${[...required].sort().join(', ')}).`,
);
