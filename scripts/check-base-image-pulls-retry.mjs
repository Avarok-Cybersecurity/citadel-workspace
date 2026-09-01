#!/usr/bin/env node
/**
 * Every step that builds images pre-pulls its base images, retried.
 *
 * `check-image-fetches-retry.mjs` requires a RUN line that downloads something
 * to sit in a retry loop. It cannot see the fetch that happens BEFORE any RUN:
 * resolving `FROM rust:1.92.0` against the registry. A run died on
 *
 *   unexpected status from HEAD request to registry-1.docker.io … 502 Bad Gateway
 *
 * and took `test:tree-permissions` with it — a red job carrying no test signal,
 * the same shape as the failure the other gate was written for. The retry had
 * reached one kind of network fetch in an image build and not the other, which
 * is this repository's most productive defect class.
 *
 * So: in each job, a step running `docker compose … --build` must be preceded
 * by a step running `pull-base-images.sh`.
 *
 * Scope, checked rather than assumed: the ~17 `npm ci` / `npm install` steps in
 * these workflows are NOT the same gap. npm retries network failures itself --
 * `fetch-retries=2`, three attempts, on 5xx and connection errors -- and cargo
 * does the same. BuildKit's base-image manifest resolution does not, which is
 * why this one needed a wrapper and those do not.
 *
 * The workflows are read as text rather than parsed. A previous gate here
 * imported `js-yaml` and broke three jobs that install no packages; that was
 * the second time, under a gate written to prevent the first.
 *
 * Node 18-compatible on purpose: the lint jobs run the oldest supported Node.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WORKFLOWS = [
  '.github/workflows/validate.yml',
  'citadel-workspaces/.github/workflows/validate.yml',
];

const SCRIPT = 'scripts/pull-base-images.sh';
const BUILDS = /docker\s+compose\s+.*--build/;
const PREPULL = /pull-base-images\.sh/;
/** A line that starts a job: two spaces, a name, a colon, nothing after. */
const JOB = /^ {2}[A-Za-z0-9_-]+:\s*$/;

if (!existsSync(join(ROOT, SCRIPT))) {
  console.error(`::error::${SCRIPT} is missing -- every step this gate requires has nothing to run`);
  process.exit(1);
}

const offences = [];
let buildSteps = 0;

for (const workflow of WORKFLOWS) {
  const path = join(ROOT, workflow);
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, 'utf8').split('\n');

  let prepulledInThisJob = false;
  lines.forEach((line, i) => {
    if (JOB.test(line)) prepulledInThisJob = false;
    if (PREPULL.test(line)) prepulledInThisJob = true;
    if (!BUILDS.test(line)) return;
    buildSteps += 1;
    if (!prepulledInThisJob) {
      offences.push({ workflow, line: i + 1 });
    }
  });
}

if (buildSteps === 0) {
  console.error('::error::found no image-building steps -- this gate cannot fail as written');
  process.exit(1);
}

if (offences.length > 0) {
  for (const o of offences) {
    console.error(
      `::error file=${o.workflow},line=${o.line}::this step builds images with no retried base-image pull before it in the same job. ` +
        `Add a step running ${SCRIPT} -- a registry 502 here fails the job with no test signal at all.`,
    );
  }
  process.exit(1);
}

console.log(`  Base images: all ${buildSteps} building step(s) pre-pull with retries  ok`);
