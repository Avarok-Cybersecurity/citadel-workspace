#!/usr/bin/env node
/**
 * The agent may only ever listen on loopback — where its network namespace is
 * the host's.
 *
 * It holds decrypted P2P plaintext and an UNAUTHENTICATED control plane: a
 * WebSocket is exempt from the same-origin policy and from CORS preflight, and
 * `GetSessions` enumerates every account signed in on the machine. There is no
 * credential between a connection and that.
 *
 * Written because it happened. `docker-compose.yml` bound `[::]` — every
 * interface — under `network_mode: host`, so a developer on café or office
 * Wi-Fi published that control plane to the network. It had been widened
 * deliberately, for a real reason (a dialer resolving `localhost` to `::1` and
 * getting ECONNREFUSED from an IPv4-only socket), and then that dialer was
 * pinned to `127.0.0.1` at the other end. Two fixes for one bug; the redundant
 * one kept its exposure, and nothing was looking.
 *
 * WHAT THIS DOES NOT FLAG, and why the distinction is the whole gate: a bind
 * address is only a boundary when the socket is on the host's network. A
 * service on a private bridge network with no `ports:` block binding `0.0.0.0`
 * is bound to the CONTAINER's interfaces — reachable only by its compose
 * siblings, and binding loopback there would make it unreachable even from
 * them. `docker-compose.local.yml` is exactly that, deliberately, and the first
 * version of this gate failed it. A gate that cries wolf on the safe file
 * teaches people to widen the unsafe one.
 *
 * So the rule is: flag a non-loopback bind only in a service that shares the
 * host's network namespace (`network_mode: host`) or publishes the port itself
 * (`ports:`).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Address forms that cannot leave the machine. */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', '::1', 'localhost', '[127.0.0.1]']);

/**
 * Services in one compose file, each with the facts that decide exposure.
 *
 * Read line by line rather than with a YAML parser: this gate runs in a job
 * that installs nothing, and a dependency here dies on `Cannot find module` and
 * takes every other gate in that job down with it. That has happened three
 * times in this repo.
 */
function services(source) {
  const found = new Map();
  const lines = source.split('\n');
  let inServices = false;
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const code = raw.split('#')[0]; // a comment is never a declaration
    if (/^services:\s*$/.test(code)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^\S/.test(code)) { inServices = false; continue; }

    const key = code.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (key) {
      current = key[1];
      found.set(current, { hostNetwork: false, publishes: false, bind: null, line: 0 });
      continue;
    }
    if (current === null) continue;
    const svc = found.get(current);

    if (/^ {4}network_mode:\s*["']?host["']?\s*$/.test(code)) svc.hostNetwork = true;
    // `ports:` with at least one entry beneath it.
    if (/^ {4}ports:\s*$/.test(code) && /^ {6}-\s*\S/.test(lines[i + 1]?.split('#')[0] ?? '')) {
      svc.publishes = true;
    }
    const bind = code.match(/INTERNAL_SERVICE_BIND_HOST\s*[=:]\s*["']?([^"'\s]+)["']?/);
    if (bind) { svc.bind = bind[1]; svc.line = i + 1; }
  }
  return found;
}

const composeFiles = readdirSync(ROOT).filter((f) => /^docker-compose[.a-z0-9-]*\.ya?ml$/.test(f));

// A guard over no files reports exactly what a guard over clean files reports.
if (composeFiles.length === 0) {
  console.error(
    'check-agent-binds-loopback: no docker-compose*.yml at the repo root, so nothing ' +
      'was checked. The layout moved.',
  );
  process.exit(1);
}

const problems = [];
let declarations = 0;
let onHostNetwork = 0;

for (const file of composeFiles) {
  for (const [name, svc] of services(readFileSync(join(ROOT, file), 'utf8'))) {
    if (svc.bind === null) continue;
    declarations += 1;
    const exposed = svc.hostNetwork || svc.publishes;
    if (exposed) onHostNetwork += 1;
    // `${VAR:-default}` is a default that can be wrong; judge the default.
    const literal = svc.bind.replace(/^\$\{[A-Z_]+:-(.*)\}$/, '$1');
    if (exposed && !LOOPBACK.has(literal)) {
      problems.push({
        file,
        line: svc.line,
        name,
        value: svc.bind,
        why: svc.hostNetwork ? 'network_mode: host' : 'publishes the port',
      });
    }
  }
}

/**
 * The IMAGE's own default, which no compose file can rescue.
 *
 * This gate read `docker-compose*.yml` only. Every compose file in the repository
 * sets `INTERNAL_SERVICE_BIND_HOST` explicitly, so all of them passed — while the
 * agent Dockerfile's CMD carried `${INTERNAL_SERVICE_BIND_HOST:-0.0.0.0}`. The
 * default therefore applied exactly when nobody was setting the variable: a bare
 * `docker run` of the published image, a new compose file, a mistyped variable
 * name. Those are the cases with no review, and this gate reported the image as
 * loopback-only throughout.
 *
 * A default has to be safe when the operator changes nothing.
 */
const DOCKERFILES = ['docker/internal-service/Dockerfile'];
let imageDefaults = 0;

for (const rel of DOCKERFILES) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    console.error(
      `check-agent-binds-loopback: ${rel} does not exist. The agent image moved, and its\n` +
        'bind default — the one no compose file can override for a bare `docker run` — is\n' +
        'no longer being checked.',
    );
    process.exit(1);
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // a comment cannot bind a socket
    for (const m of line.matchAll(/\$\{INTERNAL_SERVICE_BIND_HOST:-([^}]*)\}/g)) {
      imageDefaults += 1;
      if (!LOOPBACK.has(m[1].trim())) {
        problems.push({
          file: rel,
          line: i + 1,
          name: 'the agent image CMD',
          value: `\${INTERNAL_SERVICE_BIND_HOST:-${m[1]}}`,
          why: 'the image default, used whenever the variable is unset',
        });
      }
    }
  });
}

// Every runtime stage in that image has a CMD, and each carries the default.
// Finding none means the CMD was restructured and this half checks nothing.
if (imageDefaults === 0) {
  console.error(
    'check-agent-binds-loopback: no `${INTERNAL_SERVICE_BIND_HOST:-...}` default found in the\n' +
      'agent Dockerfile. The CMD was restructured, so the image default is unchecked.',
  );
  process.exit(1);
}

if (declarations === 0) {
  console.error(
    `check-agent-binds-loopback: no INTERNAL_SERVICE_BIND_HOST assignment in ` +
      `${composeFiles.length} compose file(s). It was renamed, and this gate checks nothing.`,
  );
  process.exit(1);
}
// The exposed case is the one this gate exists for. If no service is on the
// host's network any more, it is passing over the safe half only, and saying so
// is better than a green line that reads like coverage.
if (onHostNetwork === 0) {
  console.error(
    'check-agent-binds-loopback: no agent service uses `network_mode: host` or publishes ' +
      'its port, so the only rule this gate enforces was never evaluated.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error('The agent is bound where the network can reach it:\n');
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line} — service \`${p.name}\` (${p.why}) binds ${p.value}`);
  }
  console.error(
    '\n  The agent has NO authentication. On the host\'s network, a non-loopback bind\n' +
      '  publishes decrypted P2P plaintext and a control plane that can enumerate and\n' +
      '  act as every signed-in account, to everyone on that network.\n' +
      '\n  Use 127.0.0.1. If something cannot reach it, pin THAT dialer to 127.0.0.1 —\n' +
      '  widening the bind to reach one caller is how this happened the first time.\n',
  );
  process.exit(1);
}

console.log(
  `check-agent-binds-loopback: ${onHostNetwork} of ${declarations} compose bind(s) are on the ` +
    `host's network and all are loopback; ${imageDefaults} image CMD default(s) are loopback too.`,
);
