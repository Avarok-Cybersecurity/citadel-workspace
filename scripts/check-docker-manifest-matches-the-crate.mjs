/**
 * A Docker build that REPLACES a crate's Cargo.toml must declare the same
 * runtime dependencies it does.
 *
 * `docker/workspace-server/Dockerfile:62` copies
 * `citadel-workspace-server-kernel.Cargo.docker.toml` over the crate's own
 * manifest. It exists for a real reason — dropping dev-dependencies that would
 * otherwise unify the `localhost-testing` feature into a production build — but
 * it re-declares the entire `[dependencies]` section by hand. That makes it a
 * SECOND source for a list that already has one, and nothing kept them equal.
 *
 * The constant-time master-password comparison (`kernel/secret_eq.rs`) added
 * `sha2` and `subtle` to the crate. They were never added here, so:
 *
 *   - `cargo build` at the repository root succeeded, and so did clippy, the
 *     tests and every gate;
 *   - the SERVER IMAGE failed with `unresolved import sha2` at
 *     `cargo build --release --bin citadel-workspace-server-kernel`;
 *   - and nothing reported it until a Playwright shard tried to start the stack,
 *     where it surfaced as "Start Services" failing — a message that names
 *     neither the crate, the dependency, nor the manifest.
 *
 * The production server was unbuildable, on a branch whose 120 gates were green.
 *
 * Only `[dependencies]` is compared. `[dev-dependencies]` are deliberately absent
 * from the Docker manifest — that is the entire point of it — and features,
 * versions and the `[package]` block are left alone, because the Docker copy
 * legitimately differs there (path rewrites, feature selections). What must not
 * differ is WHICH crates the binary links.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every place a Dockerfile substitutes a manifest, and the crate it substitutes
 * it for. Derived from the `COPY` line rather than hard-coded, so a second such
 * substitution added later is covered without editing this list.
 */
const DOCKERFILES = [
  'docker/workspace-server/Dockerfile',
  'docker/internal-service/Dockerfile',
  'docker/ui/Dockerfile',
  'docker/sync/Dockerfile',
].filter((f) => existsSync(join(ROOT, f)));

/**
 * `COPY <src>Cargo.docker.toml <container path>/Cargo.toml`
 *
 * The destination is captured whole and mapped back to a repository path, because
 * two different substitutions live in the same Dockerfile: the WORKSPACE root
 * manifest (`/usr/src/app/Cargo.toml`) and one crate's (`/usr/src/app/<crate>/
 * Cargo.toml`). Matching only the last directory segment turned the first of
 * those into a crate called "app" and failed on a path that does not exist —
 * a gate reporting a fault it had invented, which is how a useful gate gets
 * switched off.
 */
const SUBSTITUTION = /COPY\s+\.?\/?(\S*Cargo\.docker\.toml)\s+(\S*\/Cargo\.toml)/g;

/** `/usr/src/app/foo/Cargo.toml` -> `foo/Cargo.toml`; the root one -> `Cargo.toml`. */
function repoPathFor(containerPath) {
  return containerPath.replace(/^\/usr\/src\/app\/?/, '') || 'Cargo.toml';
}

/** The names in a manifest's `[dependencies]` table, ignoring other tables. */
function runtimeDependencies(text) {
  const names = new Set();
  let inDeps = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      // Exactly `[dependencies]`, not `[dev-dependencies]` or `[build-dependencies]`.
      inDeps = line === '[dependencies]';
      continue;
    }
    if (!inDeps || line === '' || line.startsWith('#')) continue;
    const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
    if (name) names.add(name);
  }
  return names;
}

const problems = [];
let pairsChecked = 0;

for (const dockerfile of DOCKERFILES) {
  const text = readFileSync(join(ROOT, dockerfile), 'utf8');
  for (const match of text.matchAll(SUBSTITUTION)) {
    const [, substitute, destination] = match;
    const crate = repoPathFor(destination).replace(/\/?Cargo\.toml$/, '') || '(workspace root)';
    const substitutePath = join(ROOT, substitute);
    const cratePath = join(ROOT, repoPathFor(destination));
    if (!existsSync(substitutePath) || !existsSync(cratePath)) {
      problems.push(
        `${dockerfile}: substitutes ${substitute} for ${crate}/Cargo.toml, but one of them does not exist`,
      );
      continue;
    }
    pairsChecked += 1;
    const real = runtimeDependencies(readFileSync(cratePath, 'utf8'));
    const docker = runtimeDependencies(readFileSync(substitutePath, 'utf8'));
    const missing = [...real].filter((d) => !docker.has(d)).sort();
    const extra = [...docker].filter((d) => !real.has(d)).sort();
    // A virtual workspace root legitimately has no `[dependencies]` at all; a
    // crate with none has had its manifest or this parser moved under it.
    if (real.size === 0 && docker.size === 0 && crate !== '(workspace root)') {
      problems.push(`${relative(ROOT, cratePath)} parsed as having NO dependencies — the parser or the file moved`);
    }
    for (const dep of missing) {
      problems.push(
        `${substitute} is missing \`${dep}\`, which ${crate}/Cargo.toml declares — the image will fail with \`unresolved import ${dep}\``,
      );
    }
    for (const dep of extra) {
      problems.push(
        `${substitute} declares \`${dep}\`, which ${crate}/Cargo.toml does not — one of the two is wrong`,
      );
    }
  }
}

// Vacuity floor: the substitution exists in this repository, so finding none
// means the COPY line was reworded and this gate is checking nothing.
if (pairsChecked === 0) {
  console.error(
    'FAIL: found no Dockerfile that substitutes a Cargo.toml. The COPY line moved or was\n' +
      'reworded, so this gate examined nothing — which is how the last drift went unnoticed.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAIL: ${problems.length} disagreement(s) between a crate and its Docker manifest.\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\nA Docker manifest that replaces a crate\'s own is a second copy of its dependency\n' +
      'list. Only `[dependencies]` is compared: dev-dependencies are meant to be absent.\n' +
      'The last time these drifted, the production server image could not compile while\n' +
      'every gate on the branch was green.',
  );
  process.exit(1);
}

console.log(
  `check-docker-manifest-matches-the-crate: ${pairsChecked} substituted manifest(s) declare the ` +
    'same runtime dependencies as the crates they replace.',
);
