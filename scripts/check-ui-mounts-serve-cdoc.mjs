#!/usr/bin/env node
/**
 * Every file the Citadel Docs runtime loads is inside a directory the dev UI container mounts.
 *
 * The ui service sees only what docker-compose.yml mounts into /app. When the cdoc glue moved to
 * citadel-workspaces/vendor/, nothing mounted it: every document open in the local stack failed
 * to import its glue, while every host-side check (vitest, the production build) passed, since
 * the host has the whole tree. The runtime loads two kinds of thing:
 *
 *   - modules by dynamic import, from src/lib/cdoc/engine/load-wasm.ts (the glues);
 *   - files by URL, from src/lib/cdoc/asset-urls.ts (binaries, faces, patterns), served from public/.
 *
 * Each is resolved to its path under citadel-workspaces/, must exist (so a renamed constant
 * cannot leave this checking nothing), and must sit under a mounted path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = 'citadel-workspaces';
const COMPOSE = 'docker-compose.yml';
const LOADER = `${UI}/src/lib/cdoc/engine/load-wasm.ts`;
const URLS = `${UI}/src/lib/cdoc/asset-urls.ts`;

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const fail = (message) => {
  console.error(`check-ui-mounts-serve-cdoc: ${message}`);
  process.exit(1);
};

const service = read(COMPOSE).match(/^ {2}ui:\n((?: {4,}.*\n|\s*\n)*)/m);
if (!service) fail(`no ui service in ${COMPOSE}, so nothing was checked.`);
const mounted = [...service[1].matchAll(new RegExp(`^\\s+- \\./(${UI}/[^:]+):/app/[^:\\s]+(?::\\w+)?\\s*$`, 'gm'))].map((m) => m[1]);
if (mounted.length === 0) fail(`found no ./${UI}/... mount on the ui service; its shape changed.`);

const imports = [...new Set([...read(LOADER).matchAll(/import\('([^']+)'\)/g)].map((m) => posix.normalize(posix.join(posix.dirname(LOADER), m[1]))))];
const urls = [...read(URLS).matchAll(/=\s*'(\/[^']*)'/g)].map((m) => posix.normalize(`${UI}/public${m[1]}`).replace(/\/$/, ''));
// Two glues by import; two binaries, the faces and the patterns by URL.
if (imports.length < 2 || urls.length < 4) fail(`found ${imports.length} import(s) in ${LOADER} and ${urls.length} URL(s) in ${URLS}; their shape changed.`);

const loaded = [...imports, ...urls];
const absent = loaded.filter((path) => !existsSync(join(ROOT, path)));
if (absent.length > 0) fail(`the runtime loads paths that do not exist:\n${absent.map((p) => `  ${p}`).join('\n')}`);

const inside = (path, base) => path === base || path.startsWith(`${base}/`);
const unmounted = loaded.filter((path) => !mounted.some((base) => inside(path, base)));
if (unmounted.length > 0) {
  console.error('The Citadel Docs runtime loads files the dev UI container cannot see:\n');
  for (const path of unmounted) console.error(`  ${path}: under none of ${mounted.length} mounts of the ui service in ${COMPOSE}`);
  console.error(`\nOpening a document in the local stack fails. Mount its directory on the ui service.`);
  process.exit(1);
}

console.log(`  ${loaded.length} path(s) the Citadel Docs runtime loads are mounted in the dev UI container  ok`);
