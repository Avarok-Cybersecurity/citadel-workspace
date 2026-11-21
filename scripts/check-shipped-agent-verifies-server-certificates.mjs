#!/usr/bin/env node
/**
 * The agent shipped with Citadel Workspaces verifies every workspace server's certificate.
 *
 * The parent agent's `self-signed-servers` feature makes it take a server whose certificate
 * says it is self-signed (citadel-workspace-internal-service/src/server_certificate.rs). The
 * local stack needs it, because its server is self-signed; nothing that ships may have it. This
 * fails when a release build (the build-agent action, every workflow) names the feature, or when
 * the agent Dockerfile names it anywhere but its `dev` stage, which `production` never copies.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURE = 'self-signed-servers';

/** The problems in one agent Dockerfile's text: the feature before its `dev` stage. */
export function dockerfileProblems(text) {
  const dev = text.search(/^FROM \S+ AS dev\s*$/m);
  const at = text.indexOf(FEATURE);
  if (at === -1) return [];
  if (dev === -1 || at < dev) return [`the agent Dockerfile names ${FEATURE} outside its dev stage`];
  const later = text.slice(dev + 1).search(/^FROM /m);
  return later === -1 ? [] : [`the agent Dockerfile has a stage after dev, which could copy the ${FEATURE} build`];
}

/** The problems in a release build's text: any mention of the feature. */
export function releaseProblems(label, text) {
  return text.includes(FEATURE) ? [`${label} builds the agent with ${FEATURE}`] : [];
}

function main() {
  const problems = [];
  problems.push(...dockerfileProblems(readFileSync(join(ROOT, 'docker/internal-service/Dockerfile'), 'utf8')));
  const release = ['.github/actions/build-agent/action.yml'];
  for (const name of readdirSync(join(ROOT, '.github/workflows'))) release.push(`.github/workflows/${name}`);
  for (const path of release) problems.push(...releaseProblems(path, readFileSync(join(ROOT, path), 'utf8')));
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error(`\nFAIL: the shipped agent must verify server certificates (${problems.length} problem(s)).`);
    process.exit(1);
  }
  console.log(`check-shipped-agent-verifies-server-certificates: ${FEATURE} is confined to the dev image.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
