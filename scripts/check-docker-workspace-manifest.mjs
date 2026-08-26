#!/usr/bin/env node
/**
 * The production server image builds against a SUBSTITUTE root manifest.
 *
 * `docker/workspace-server/Dockerfile` does:
 *
 *   COPY ./docker/workspace-server/Cargo.docker.toml /usr/src/app/Cargo.toml
 *
 * so the real root `Cargo.toml` — the one every developer edits — is never seen
 * by that build. Any `{ workspace = true }` dependency a member declares must
 * therefore be defined in BOTH files. Adding one to the real root alone leaves
 * the image unbuildable:
 *
 *   error inheriting `citadel_user` from workspace root manifest's
 *   `workspace.dependencies.citadel_user`
 *
 * Cargo fails there while LOADING the manifest, so `cargo clippy` never starts
 * and the failure names a dependency rather than the duplicated file that caused
 * it. It also cannot be caught by any local `cargo` command, because locally the
 * real root manifest is correct — only the image build is broken, and only in
 * CI. This happened for real: the credential-mirror guard added a
 * dev-dependency, and the production server image could not be built from that
 * commit onward.
 *
 * Dev-dependencies count. Cargo parses every dependency table when it loads a
 * member manifest, so a missing entry fails the build even though the image
 * excludes `tests/`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DOCKER_ROOT = 'docker/workspace-server/Cargo.docker.toml';

/** Members the Docker build actually copies in, from its own manifest. */
function workspaceMembers(manifestText) {
  const block = manifestText.match(/members\s*=\s*\[([^\]]*)\]/s);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Names defined under [workspace.dependencies]. */
function definedDeps(manifestText) {
  const section = manifestText.split(/^\[workspace\.dependencies\]$/m)[1];
  if (!section) return new Set();
  const upToNextSection = section.split(/^\[/m)[0];
  return new Set(
    upToNextSection
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/\s*=/)[0].trim())
      .filter(Boolean)
  );
}

/** Every dependency a member inherits, across all dependency tables. */
function inheritedDeps(manifestText) {
  return new Set(
    [...manifestText.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*workspace\s*=\s*true/gm)].map(
      (m) => m[1]
    )
  );
}

if (!existsSync(DOCKER_ROOT)) {
  console.error(`${DOCKER_ROOT} not found — did the production build layout change?`);
  process.exit(1);
}

const dockerRootText = readFileSync(DOCKER_ROOT, 'utf8');
const defined = definedDeps(dockerRootText);
const problems = [];

for (const member of workspaceMembers(dockerRootText)) {
  // The Dockerfile swaps in a per-member manifest for the kernel itself; prefer
  // that one where it exists, since it is what the image actually compiles.
  const substitute = join(dirname(DOCKER_ROOT), `${member}.Cargo.docker.toml`);
  const memberManifest = existsSync(substitute) ? substitute : join(member, 'Cargo.toml');
  if (!existsSync(memberManifest)) continue;

  for (const dep of inheritedDeps(readFileSync(memberManifest, 'utf8'))) {
    if (!defined.has(dep)) {
      problems.push(`${memberManifest} inherits \`${dep}\`, which ${DOCKER_ROOT} does not define`);
    }
  }
}

if (problems.length > 0) {
  console.error('The production server image would fail to load its manifest:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nAdd each one to [workspace.dependencies] in ${DOCKER_ROOT}.`);
  process.exit(1);
}

console.log('Every workspace-inherited dependency is defined in the Docker root manifest.');
