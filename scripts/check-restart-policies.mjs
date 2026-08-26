#!/usr/bin/env node
/**
 * Every long-running service must declare a restart policy.
 *
 * Without one, a container that exits stays exited — a transient failure
 * becomes permanent downtime with no signal beyond the workspace simply being
 * gone. This is not hypothetical here: the server binds the host's port
 * (`network_mode: host`) and has been observed exiting with "Address already in
 * use (os error 98)" when started before the previous process released it.
 * Restarting is exactly what deploying a new image does, so the failure window
 * sits precisely on the upgrade path.
 *
 * One-shot containers are the exception and must NOT restart — `sync-wasm-client`
 * builds the WASM client and exits 0, and a restart policy would loop it
 * forever. It declares `restart: "no"` so the intent is explicit rather than
 * absent, which is what this check requires.
 */
import { readFileSync } from 'node:fs';

const COMPOSE = 'docker-compose.yml';
const text = readFileSync(COMPOSE, 'utf8');

// Services are the two-space-indented keys under `services:`; volumes and
// networks live at the same indentation, so stop at the first top-level key
// after them.
const servicesBlock = /^services:\n([\s\S]*?)(?=^[a-z]+:$|$(?![\s\S]))/m.exec(text);
if (!servicesBlock) throw new Error(`could not find a services: block in ${COMPOSE}`);

const names = [...servicesBlock[1].matchAll(/^  ([a-z][\w-]*):$/gm)].map((m) => m[1]);
if (names.length === 0) throw new Error(`parsed no services from ${COMPOSE}`);

const missing = [];
for (const name of names) {
  const body = new RegExp(`^  ${name}:$\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:$|^[a-z]+:$|$(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? '';
  if (!/^\s*restart:\s*\S+/m.test(body)) missing.push(name);
}

if (missing.length > 0) {
  console.error('Services with no restart policy (an exit becomes permanent downtime):\n');
  for (const name of missing) console.error(`  - ${name}`);
  console.error(
    '\nUse `restart: unless-stopped` for long-running services, or `restart: "no"` ' +
      'for one-shot containers so the intent is stated rather than absent.',
  );
  process.exit(1);
}

console.log(`Restart policies declared for all ${names.length} services.`);
