#!/usr/bin/env node
/**
 * Every Rust workspace member must be COPY'd into every image that runs cargo.
 *
 * Cargo loads EVERY member's manifest before building any of them, so a crate
 * an image never builds still breaks that image if it is missing:
 *
 *   error: failed to load manifest for workspace member
 *          `/usr/src/app/citadel-workspace-executor`
 *
 * That is how `citadel-workspace-executor` took down both service images and
 * all three Playwright shards — the crate was added to Cargo.toml, to the CI
 * matrices and to the crate-coverage guard, and to neither Dockerfile. Nothing
 * connected the workspace's membership list to the images' COPY lists, and the
 * failure surfaces as a Docker build error inside an integration job, which is
 * about as far from the edit as it gets.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Images whose build runs cargo against the root workspace. */
const DOCKERFILES = [
  'docker/internal-service/Dockerfile',
  'docker/workspace-server/Dockerfile',
];

const cargoToml = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8');
const membersBlock = cargoToml.match(/members\s*=\s*\[([^\]]*)\]/);

if (!membersBlock) {
  console.error('check-dockerfiles-copy-every-crate: no members list in Cargo.toml.');
  process.exit(1);
}

const members = [...membersBlock[1].matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((m) => !m.startsWith('.') && !m.includes('*'));

// A members list this scan cannot read looks exactly like a passing scan.
if (members.length < 3) {
  console.error(
    `check-dockerfiles-copy-every-crate: only ${members.length} member(s) parsed — ` +
      'the workspace manifest changed shape, so this comparison cannot be trusted.',
  );
  process.exit(1);
}

const problems = [];

for (const dockerfile of DOCKERFILES) {
  let source;
  try {
    source = readFileSync(join(ROOT, dockerfile), 'utf8');
  } catch {
    problems.push(`${dockerfile}: cannot be read, so nothing was checked`);
    continue;
  }

  for (const member of members) {
    // A nested member (citadel-workspace-server-kernel/tests/common) arrives
    // with its ancestor's directory COPY, so any prefix counts.
    const covered = member
      .split('/')
      .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
      .some((prefix) => source.includes(`./${prefix}`) || source.includes(`/${prefix} `));

    if (!covered) problems.push(`${dockerfile}: does not COPY ${member}`);
  }
}

if (problems.length > 0) {
  console.error('A Rust workspace member is missing from an image that runs cargo:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nCargo reads every member manifest before building any crate, so the image' +
      '\nfails with "failed to load manifest for workspace member" even though it' +
      '\nnever builds that crate. Add a COPY line beside the others.',
  );
  process.exit(1);
}

console.log(
  `All ${members.length} workspace members are COPY'd into both cargo images.`,
);
