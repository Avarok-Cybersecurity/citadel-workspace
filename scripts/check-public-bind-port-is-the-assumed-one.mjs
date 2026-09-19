/**
 * Advice to publish the server must name the port the app assumes.
 *
 * A user who joins by typing only a hostname is sent to DEFAULT_WORKSPACE_PORT
 * (citadel-workspaces/src/lib/workspace-address.ts). INSTALL.md and the
 * production compose told operators to publish on 0.0.0.0:12349, so a server
 * set up by the book answered on a port no bare hostname reaches: every such
 * join failed with a connection error, and only people who knew to type the
 * port got in.
 *
 * The assumed port is read from the UI, never listed here.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = 'citadel-workspaces/src/lib/workspace-address.ts';

if (!existsSync(join(ROOT, UI))) {
  console.error(`FAIL: ${UI} not found (is the citadel-workspaces submodule checked out?).`);
  process.exit(1);
}
const assumed = readFileSync(join(ROOT, UI), 'utf8').match(/export const DEFAULT_WORKSPACE_PORT: number = (\d+);/);
if (!assumed) {
  console.error(`FAIL: no DEFAULT_WORKSPACE_PORT in ${UI}; the pattern must have changed.`);
  process.exit(1);
}
const port = assumed[1];

const files = [
  ...readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  'docker-compose.production.yml',
  '.env.example',
].filter((f) => existsSync(join(ROOT, f)));

const wrong = [];
let advised = 0;
for (const f of files) {
  readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/WORKSPACE_BIND_ADDR=0\.0\.0\.0:(\d+)/g)) {
      advised += 1;
      if (m[1] !== port) wrong.push(`${f}:${i + 1}  advises 0.0.0.0:${m[1]}`);
    }
  });
}

if (advised === 0) {
  console.error('FAIL: no WORKSPACE_BIND_ADDR=0.0.0.0:<port> advice found; an operator is never told how to publish the server.');
  process.exit(1);
}
if (wrong.length > 0) {
  console.error(`FAIL: the app assumes port ${port} for a bare hostname (${UI}), but:\n`);
  for (const w of wrong) console.error(`  ${w}`);
  console.error(`\nA server published on another port is unreachable by hostname alone.`);
  process.exit(1);
}
console.log(`check-public-bind-port-is-the-assumed-one: ${advised} publish instruction(s), all on ${port}, the port the app assumes.`);
