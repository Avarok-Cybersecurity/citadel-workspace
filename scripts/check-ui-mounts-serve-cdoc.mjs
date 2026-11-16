#!/usr/bin/env node
/**
 * Every file the Citadel Docs runtime and the Calendar load is inside a directory the dev UI
 * container mounts.
 *
 * The ui service sees only what docker-compose.yml mounts into /app. When the cdoc glue moved to
 * citadel-workspaces/vendor/, nothing mounted it: every document open in the local stack failed
 * to import its glue, while every host-side check (vitest, the production build) passed, since
 * the host has the whole tree. The runtime loads two kinds of thing:
 *
 *   - modules by dynamic import, from src/lib/cdoc/engine/load-wasm.ts (the glues);
 *   - files by URL, from src/lib/cdoc/asset-urls.ts (binaries, faces, patterns), served from public/.
 *
 * The Calendar loads the same two kinds, from src/lib/calendar/engine/load-calendar-wasm.ts (its
 * glue) and src/lib/calendar/asset-urls.ts (its binary), and is held to the same rule.
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
/** Each runtime, its loader and its URLs, and how many of each its shape has (fewer means it changed). */
const RUNTIMES = [
  // Two glues by import; two binaries, the faces and the patterns by URL.
  { name: 'Citadel Docs', loader: `${UI}/src/lib/cdoc/engine/load-wasm.ts`, urls: `${UI}/src/lib/cdoc/asset-urls.ts`, imports: 2, served: 4 },
  // One glue by import; its binary by URL.
  { name: 'Calendar', loader: `${UI}/src/lib/calendar/engine/load-calendar-wasm.ts`, urls: `${UI}/src/lib/calendar/asset-urls.ts`, imports: 1, served: 1 },
];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const fail = (message) => {
  console.error(`check-ui-mounts-serve-cdoc: ${message}`);
  process.exit(1);
};

const service = read(COMPOSE).match(/^ {2}ui:\n((?: {4,}.*\n|\s*\n)*)/m);
if (!service) fail(`no ui service in ${COMPOSE}, so nothing was checked.`);
const mounted = [...service[1].matchAll(new RegExp(`^\\s+- \\./(${UI}/[^:]+):/app/[^:\\s]+(?::\\w+)?\\s*$`, 'gm'))].map((m) => m[1]);
if (mounted.length === 0) fail(`found no ./${UI}/... mount on the ui service; its shape changed.`);

const loaded = RUNTIMES.flatMap(({ name, loader, urls: urlFile, imports: wantImports, served }) => {
  const imports = [...new Set([...read(loader).matchAll(/import\('([^']+)'\)/g)].map((m) => posix.normalize(posix.join(posix.dirname(loader), m[1]))))];
  const urls = [...read(urlFile).matchAll(/=\s*'(\/[^']*)'/g)].map((m) => posix.normalize(`${UI}/public${m[1]}`).replace(/\/$/, ''));
  if (imports.length < wantImports || urls.length < served) fail(`${name}: found ${imports.length} import(s) in ${loader} and ${urls.length} URL(s) in ${urlFile}; their shape changed.`);
  return [...imports, ...urls];
});
const absent = loaded.filter((path) => !existsSync(join(ROOT, path)));
if (absent.length > 0) fail(`the runtime loads paths that do not exist:\n${absent.map((p) => `  ${p}`).join('\n')}`);

const inside = (path, base) => path === base || path.startsWith(`${base}/`);
const unmounted = loaded.filter((path) => !mounted.some((base) => inside(path, base)));
if (unmounted.length > 0) {
  console.error('The Citadel Docs or Calendar runtime loads files the dev UI container cannot see:\n');
  for (const path of unmounted) console.error(`  ${path}: under none of ${mounted.length} mounts of the ui service in ${COMPOSE}`);
  console.error(`\nOpening a document or the Calendar in the local stack fails. Mount its directory on the ui service.`);
  process.exit(1);
}

console.log(`  ${loaded.length} path(s) the Citadel Docs and Calendar runtimes load are mounted in the dev UI container  ok`);
