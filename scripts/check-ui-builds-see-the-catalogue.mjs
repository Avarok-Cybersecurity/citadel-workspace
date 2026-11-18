#!/usr/bin/env node
/**
 * Every container that runs the UI's vite config can read the parent files it reads: the app
 * catalogue, and the agent crate's Cargo.toml (its version is /version.json's `agent`).
 *
 * vite.config.ts reads each relative to the UI directory and fails the build when one is
 * missing, by design. The market stream mounted the catalogue into the `ui` service and copied
 * it into docker/ui/Dockerfile, but not into `sync-wasm-client`, which also runs `vite build`
 * over a mounted citadel-workspaces/: the sync died with
 * "ENOENT /workspace/apps/catalogue/catalogue.json" and every integration job behind it went
 * with it.
 *
 * The relative paths are read from vite.config.ts (every `path.resolve(__dirname, '../…')`), so
 * moving a file there moves the requirement here. For each compose service that mounts
 * citadel-workspaces/ (or a path under it), the UI root inside the container is derived from
 * that mount and each file's directory must be mounted at the same relative place. For each
 * Dockerfile that COPYs the whole citadel-workspaces/, each file (or its directory) must be
 * COPY'd to the same relative place beside it.
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

const reads = [...read(VITE).matchAll(/path\.resolve\(__dirname,\s*'(\.\.\/[^']+)'\)/g)].map((m) => {
  const file = posix.normalize(posix.join(UI, m[1]));
  return { file, dir: posix.dirname(file), fromUi: posix.dirname(m[1]) };
});
if (!reads.some((r) => r.file.endsWith('catalogue.json'))) fail(`${VITE} no longer reads catalogue.json via path.resolve(__dirname, '../...'); its shape changed.`);
for (const { file } of reads) if (!existsSync(join(ROOT, file))) fail(`${file}, which ${VITE} reads, does not exist.`);

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
      for (const { dir, fromUi } of reads) {
        const want = posix.normalize(posix.join(root, fromUi));
        if (!mounts.some((m) => m.source === dir && m.target === want)) problems.push(`${file}: ${name} mounts ${UI}/ at ${root} but not ./${dir} at ${want}`);
      }
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
  for (const { dest } of copies.filter((c) => c.source === UI)) {
    dockerfiles += 1;
    for (const { file: needed, dir } of reads) {
      const beside = (source) => posix.normalize(posix.join(posix.dirname(dest), source));
      const ok = copies.some((c) => (c.source === dir || c.source === needed) && posix.normalize(c.dest) === beside(c.source));
      if (!ok) problems.push(`${file}: COPYs ${UI} to ${dest} but not ${needed} (or ${dir}/) beside it`);
    }
  }
}

if (services + dockerfiles < 3) fail(`found ${services} service(s) and ${dockerfiles} Dockerfile COPY(s) of ${UI}/; the files changed shape, so nothing was checked.`);

if (problems.length > 0) {
  console.error(`A container that runs ${VITE} cannot read a file it reads:\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe UI build fails without them, deliberately. Mount or COPY each beside the UI.');
  process.exit(1);
}

console.log(`  ${services} compose service(s) and ${dockerfiles} Dockerfile(s) running the UI see ${reads.map((r) => r.file).join(', ')}  ok`);
