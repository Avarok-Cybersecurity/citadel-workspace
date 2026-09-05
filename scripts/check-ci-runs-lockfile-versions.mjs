#!/usr/bin/env node
// A CI step that runs `npm install <pkg>@<version>` overrides what the lockfile
// resolves, so CI exercises a different version of that package than every
// developer and every other job. A green run then says nothing about the
// version anyone else will actually use.
//
// This existed: `npm install vitest@3.0.7 --save-dev` ran in the unit-tests
// job while the root lockfile resolved vitest 3.2.7. The unit suite was green
// on a version no one ran.
//
// The rule: if the root lockfile already resolves a package, no workflow may
// install a pinned version of it. Packages the lockfile does NOT resolve are
// allowed -- installing a tool that is genuinely absent is not this defect.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = join(root, '.github', 'workflows');

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const resolved = new Map();
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  const marker = 'node_modules/';
  const at = path.lastIndexOf(marker);
  if (at === -1 || !meta.version) continue;
  const name = path.slice(at + marker.length);
  if (!resolved.has(name)) resolved.set(name, meta.version);
}

// `npm install foo@1.2.3`, `npm i -D foo@1.2.3`, `npm add foo@1.2.3`
const INSTALL = /\bnpm\s+(?:install|i|add)\b([^\n&|;]*)/g;
const PINNED = /(?:^|\s)((?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*)@([0-9][^\s]*)/gi;

const failures = [];
for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
  const lines = readFileSync(join(workflowDir, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // a comment describing the defect is not the defect
    for (const [, tail] of line.matchAll(INSTALL)) {
      for (const [, name, version] of tail.matchAll(PINNED)) {
        const have = resolved.get(name);
        if (!have) continue;
        const why =
          have === version
            ? `matches the lockfile today, so it is silent -- and drifts into a ` +
              `mismatch the moment the lockfile moves`
            : `DIFFERS from the lockfile's ${name}@${have}: CI is testing a ` +
              `version no one else runs`;
        failures.push(
          `${file}:${i + 1}  pins ${name}@${version}, which ${why}.\n` +
            `    ${line.trim()}`,
        );
      }
    }
  });
}

if (failures.length) {
  console.error('CI installs versions the lockfile does not resolve:\n');
  for (const f of failures) console.error('  ' + f + '\n');
  console.error(
    'Delete the install step. The root `npm ci` already puts the lockfile\n' +
      'version in node_modules/.bin, which is what the run step invokes.',
  );
  process.exit(1);
}

console.log(
  `OK: no workflow pins a package version over the lockfile ` +
    `(${resolved.size} packages resolved).`,
);
