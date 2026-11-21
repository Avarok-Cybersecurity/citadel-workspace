#!/usr/bin/env node
/**
 * Every script sync-wasm-clients.sh runs with node must exist inside the sync image.
 *
 * The sync container sees only what docker/sync/Dockerfile COPYs and what the
 * compose service mounts; the parent's scripts/ directory is neither. When the
 * WASM build began stripping names with scripts/strip-wasm-names.mjs, every run
 * of the container died with
 *
 *   Error: Cannot find module '/workspace/scripts/strip-wasm-names.mjs'
 *
 * right after it had cleaned typescript-client, so the UI's production build
 * then failed on a package with no dist/ ("EISDIR ... citadel-internal-service-
 * wasm-client"), two steps and one container away from the cause. Running the
 * script on a host, as everyone does locally, cannot show it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'sync-wasm-clients.sh';
const DOCKERFILE = 'docker/sync/Dockerfile';
const COMPOSE = 'docker-compose.yml';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

// The script and every file it `source`s (scripts/lib/wasm-pkg.sh holds the build and
// the stamp now): a sourced file must be in the image too, and its node calls count.
const sourced = [...read(SCRIPT).matchAll(/^\s*(?:source|\.) "\$WORKSPACE_ROOT\/([^"]+)"/gm)].map((m) => m[1]);
// `node "$WORKSPACE_ROOT/..."` anywhere on a line, a command substitution included:
// `remap="$(node "$WORKSPACE_ROOT/scripts/remap-path-env.mjs" ...)"` was invisible to the
// old line-start pattern, so the image lacked it and the check passed.
const nodeCalls = /(?:^|[\s(])node "\$WORKSPACE_ROOT\/([^"]+)"/gm;
const direct = [SCRIPT, ...sourced].flatMap((file) => [...read(file).matchAll(nodeCalls)].map((m) => m[1]));
// What those scripts import, relatively, at any depth: node needs it in the image too.
const imported = [];
for (const file of direct) {
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const m of read(current).matchAll(/\bfrom '(\.{1,2}\/[^']+)'/g)) {
      const next = relative(ROOT, resolve(ROOT, dirname(current), m[1]));
      if (!imported.includes(next)) {
        imported.push(next);
        queue.push(next);
      }
    }
  }
}
const invoked = [...direct, ...imported, ...sourced];
const copied = [...read(DOCKERFILE).matchAll(/^COPY\s+\.\/(\S+)/gm)].map((m) => m[1]);

const compose = read(COMPOSE);
const service = compose.match(/^ {2}sync-wasm-client:\n((?: {4,}.*\n|\s*\n)*)/m);
if (!service) {
  console.error(`check-sync-image-has-its-scripts: no sync-wasm-client service in ${COMPOSE}, so nothing was checked.`);
  process.exit(1);
}
const mounted = [...service[1].matchAll(/^\s+- \.\/([^:]+):\/workspace\/\1(?::\w+)?\s*$/gm)].map((m) => m[1]);

// A script this scan cannot see looks exactly like a passing scan.
if (invoked.length === 0) {
  console.error(`check-sync-image-has-its-scripts: found no \`node "$WORKSPACE_ROOT/..."\` call in ${SCRIPT} or what it sources; its shape changed.`);
  process.exit(1);
}

const inside = (path, base) => path === base || path.startsWith(base.endsWith('/') ? base : `${base}/`);
const missing = invoked.filter((path) => ![...copied, ...mounted].some((base) => inside(path, base)));

if (missing.length > 0) {
  console.error('sync-wasm-clients.sh runs a script the sync image does not have:\n');
  for (const path of missing) console.error(`  ${path}: neither COPY'd by ${DOCKERFILE} nor mounted by ${COMPOSE}`);
  console.error(`\nThe container fails with "Cannot find module" after it has cleaned the build output.\nCOPY it beside sync-wasm-clients.sh in ${DOCKERFILE}.`);
  process.exit(1);
}

console.log(`  ${invoked.length} script(s) sync-wasm-clients.sh sources or runs with node are in the sync image  ok`);
