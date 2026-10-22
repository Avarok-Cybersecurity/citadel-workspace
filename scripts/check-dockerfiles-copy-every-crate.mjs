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
 *
 * There are two workspaces. This once read only the parent's members and only
 * two hand-listed parent Dockerfiles, so the agent repo's own
 * `ci/Dockerfile.websocket-server` (context: the agent repo, workspace: its
 * Cargo.toml) was never compared with anything, and six new agent crates broke
 * it in the agent's CI. Dockerfiles are now discovered, and each is checked
 * against the workspace of the repo whose directory is its build context.
 *
 * Coverage is judged from parsed COPY sources, not substrings: a source that is
 * the member's directory or one of its ancestors counts. A substring test let
 * `./citadel-internal-service` stand in for `citadel-internal-service-types`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each workspace, the directory its images build from, and where those live. */
const WORKSPACES = [
  { context: '.', searchDirs: ['docker', 'deploy'] },
  { context: 'citadel-internal-service', searchDirs: ['ci', 'docker', 'deploy'] },
];

/** Images known to run cargo; discovery finding fewer means discovery broke. */
const KNOWN = [
  'docker/internal-service/Dockerfile',
  'docker/workspace-server/Dockerfile',
  'citadel-internal-service/ci/Dockerfile.websocket-server',
];

const SKIP_DIRS = new Set(['node_modules', 'target', '.git']);

function dockerfilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...dockerfilesUnder(path));
    } else if (/^Dockerfile/.test(entry.name) || entry.name.endsWith('.Dockerfile')) {
      found.push(path);
    }
  }
  return found;
}

function membersOf(manifestPath) {
  const block = readFileSync(manifestPath, 'utf8').match(/members\s*=\s*\[([^\]]*)\]/);
  if (!block) return null;
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((m) => !m.startsWith('.') && !m.includes('*'));
}

/** Context-relative sources of every COPY/ADD that reads the build context. */
function copySources(source) {
  const joined = source.replace(/\\\r?\n/g, ' ');
  const sources = [];
  for (const line of joined.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:COPY|ADD)\s+(.*)$/i);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/);
    if (tokens.some((t) => /^--from=/i.test(t))) continue;
    const paths = tokens.filter((t) => !t.startsWith('--'));
    for (const p of paths.slice(0, -1)) {
      sources.push(p.replace(/^\.\//, '').replace(/\/+$/, '') || '.');
    }
  }
  return sources;
}

const runsCargo = (source) => /^\s*RUN\b.*\bcargo\s+(build|check|test|clippy|install\s+--path)/m.test(source.replace(/\\\r?\n/g, ' '));

const problems = [];
const checked = [];
let memberCount = 0;

for (const { context, searchDirs } of WORKSPACES) {
  const contextDir = join(ROOT, context);
  const manifest = join(contextDir, 'Cargo.toml');
  const members = existsSync(manifest) ? membersOf(manifest) : null;
  // A members list this scan cannot read looks exactly like a passing scan.
  if (!members || members.length < 3) {
    problems.push(`${join(context, 'Cargo.toml')}: members list unreadable, so its images were not checked`);
    continue;
  }
  memberCount += members.length;

  for (const path of searchDirs.flatMap((d) => dockerfilesUnder(join(contextDir, d)))) {
    const rel = relative(ROOT, path);
    const source = readFileSync(path, 'utf8');
    if (!runsCargo(source)) continue;
    checked.push(rel);
    const sources = copySources(source);
    for (const member of members) {
      const covered = sources.some(
        (s) => s === '.' || member === s || member.startsWith(`${s}/`),
      );
      if (!covered) problems.push(`${rel}: does not COPY ${member} (a member of ${join(context, 'Cargo.toml')})`);
    }
  }
}

for (const known of KNOWN) {
  if (!checked.includes(known)) problems.push(`${known}: not discovered as a cargo image, so discovery is broken`);
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

console.log(`All ${memberCount} workspace members are COPY'd into the ${checked.length} cargo images: ${checked.join(', ')}.`);
