#!/usr/bin/env node
/**
 * Every container that runs the UI's vite config can read the app catalogue.
 *
 * vite.config.ts reads the parent's apps/catalogue/catalogue.json relative to
 * the UI directory and fails the build when it is missing, by design. The
 * market stream mounted it into the `ui` service and copied it into
 * docker/ui/Dockerfile, but not into `sync-wasm-client`, which also runs
 * `vite build` over a mounted citadel-workspaces/: the sync died with
 * "ENOENT /workspace/apps/catalogue/catalogue.json" and every integration job
 * behind it went with it.
 *
 * The relative path is read from vite.config.ts, so moving the file there moves
 * the requirement here. For each compose service that mounts citadel-workspaces/
 * (or a path under it), the UI root inside the container is derived from that
 * mount and the catalogue directory must be mounted at the same relative place.
 * For each Dockerfile that COPYs the whole citadel-workspaces/, the catalogue
 * must be COPY'd to the same relative place beside it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = 'citadel-workspaces';
const VITE = `${UI}/vite.config.ts`;
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.local.yml'];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const fail = (message) => {
  console.error(`check-ui-builds-see-the-catalogue: ${message}`);
  process.exit(1);
};

const resolved = read(VITE).match(/path\.resolve\(__dirname,\s*'([^']*catalogue\.json)'\)/);
if (!resolved) fail(`${VITE} no longer reads catalogue.json via path.resolve(__dirname, ...); its shape changed.`);
const fromUi = posix.dirname(resolved[1]);
const hostDir = posix.normalize(posix.join(UI, fromUi));
if (!existsSync(join(ROOT, hostDir, 'catalogue.json'))) fail(`${hostDir}/catalogue.json, which ${VITE} reads, does not exist.`);

const problems = [];
let services = 0;
let dockerfiles = 0;

for (const file of COMPOSE_FILES.filter((f) => existsSync(join(ROOT, f)))) {
  const text = read(file);
  const blocks = text.split(/^ {2}(?=[a-z][\w-]*:$)/m).slice(1);
  for (const block of blocks) {
    const name = block.slice(0, block.indexOf(':'));
    const mounts = [...block.matchAll(/^\s+- \.\/([^:\s]+):([^:\s]+)(?::\w+)?\s*$/gm)].map((m) => ({
      source: posix.normalize(m[1]).replace(/\/$/, ''),
      target: m[2].replace(/\/$/, ''),
    }));
    const roots = new Set();
    for (const { source, target } of mounts) {
      if (source !== UI && !source.startsWith(`${UI}/`)) continue;
      const below = source.slice(UI.length);
      if (!target.endsWith(below)) {
        problems.push(`${file}: ${name} mounts ./${source} at ${target}, which does not end in ${below}`);
        continue;
      }
      roots.add(target.slice(0, target.length - below.length) || '/');
    }
    if (roots.size === 0) continue;
    services += 1;
    for (const root of roots) {
      const want = posix.normalize(posix.join(root, fromUi));
      const ok = mounts.some((m) => m.source === hostDir && m.target === want);
      if (!ok) problems.push(`${file}: ${name} mounts ${UI}/ at ${root} but not ./${hostDir} at ${want}`);
    }
  }
}

const dockerfilesUnder = (dir) =>
  !existsSync(join(ROOT, dir))
    ? []
    : readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? dockerfilesUnder(posix.join(dir, e.name)) : /^Dockerfile/.test(e.name) ? [posix.join(dir, e.name)] : [],
      );

for (const file of [...dockerfilesUnder('docker'), ...dockerfilesUnder('deploy')]) {
  const copies = [...read(file).matchAll(/^\s*COPY\s+(?!--from)(?:--\S+\s+)*(\S+)\s+(\S+)\s*$/gm)].map((m) => ({
    source: posix.normalize(m[1].replace(/^\.\//, '')).replace(/\/$/, ''),
    dest: m[2].replace(/\/$/, ''),
  }));
  for (const { source, dest } of copies.filter((c) => c.source === UI)) {
    dockerfiles += 1;
    const want = posix.normalize(posix.join(posix.dirname(dest), hostDir));
    if (!copies.some((c) => c.source === hostDir && posix.normalize(c.dest) === want)) {
      problems.push(`${file}: COPYs ${UI} to ${dest} but not ${hostDir} to ${want}`);
    }
  }
}

if (services + dockerfiles < 3) fail(`found ${services} service(s) and ${dockerfiles} Dockerfile COPY(s) of ${UI}/; the files changed shape, so nothing was checked.`);

if (problems.length > 0) {
  console.error(`A container that runs ${VITE} cannot read ${hostDir}/catalogue.json:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe UI build fails without it, deliberately. Mount or COPY the catalogue beside the UI.');
  process.exit(1);
}

console.log(`  ${services} compose service(s) and ${dockerfiles} Dockerfile(s) running the UI see ${hostDir}/  ok`);
