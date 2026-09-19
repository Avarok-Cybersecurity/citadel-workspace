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
// The required set is DERIVED (scripts/lib/required-env.mjs: compose and
// deploy.sh's refusals), never listed here, so a new required variable is a
// failure until documented.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredEnv } from './lib/required-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/INSTALL.md';

const required = requiredEnv(root);

const doc = readFileSync(join(root, DOC), 'utf8');
const missing = [...required.keys()].filter((name) => !doc.includes(name));

if (missing.length) {
  console.error(`${DOC} does not name every variable a production deploy requires:\n`);
  for (const name of missing) {
    console.error(
      `  ${name}  -- required by ${required.get(name)}, so the deploy cannot ` +
        `start without it,\n      and the doc never tells the reader to set it.`,
    );
  }
  console.error(
    `\nDocument it in ${DOC}, or drop the requirement if a default is genuinely safe.`,
  );
  process.exit(1);
}

console.log(
  `OK: ${DOC} names all ${required.size} variables a production deploy requires ` +
    `(${[...required.keys()].sort().join(', ')}).`,
);
