#!/usr/bin/env node
// The agent instructions in CLAUDE.md and .claude/agents/ are executed, not
// read. When one names a thing that does not exist, nothing errors -- the
// agent waits for a log line that never comes, or opens a port nothing serves,
// and reports a timeout that looks like a broken service.
//
// Three ways that happened at once, all found on 2026-09-05:
//   * every UI agent opened :5173 after the dev server moved to :5291
//   * three agents ran `tilt logs workspace-server`, which names no resource
//   * the sync agent waited for ``Running `target/debug/...` `` while the
//     containers run release binaries from /usr/local/bin, so steps 2 and 3
//     timed out at five minutes on every HEALTHY rebuild
//
// Each is mechanical to check against its own source of truth.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const docs = [join(root, 'CLAUDE.md')];
const agentDir = join(root, '.claude', 'agents');
if (existsSync(agentDir)) {
  for (const f of readdirSync(agentDir).filter((f) => f.endsWith('.md'))) {
    docs.push(join(agentDir, f));
  }
}

// --- source of truth 1: the Tiltfile's dc_resource names -------------------
const tiltfile = readFileSync(join(root, 'Tiltfile'), 'utf8');
const resources = new Set(
  [...tiltfile.matchAll(/dc_resource\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
);
if (resources.size === 0) throw new Error('no dc_resource() found in Tiltfile');

// --- source of truth 2: every port the stack declares ----------------------
// A doc may name any port something in the stack binds or exposes. A port that
// appears NOWHERE in compose, the Tiltfile or a Dockerfile is served by
// nothing -- which is what :5173 became when the dev server moved to :5291.
const declaredPorts = new Set();
for (const f of [
  'docker-compose.yml',
  'Tiltfile',
  'docker/ui/Dockerfile',
  'docker/internal-service/Dockerfile',
  'docker/workspace-server/Dockerfile',
]) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  // Port-shaped contexts only. A bare 4-digit number in a Dockerfile is far
  // more often a timeout or a size than a port, and letting those in would
  // make this rule quietly accept almost any number.
  const text = readFileSync(p, 'utf8');
  const PORT_CONTEXTS = [
    /^EXPOSE\s+(\d{2,5})/gm,          // EXPOSE 5291
    /['"](?:\d{2,5}:)?(\d{2,5})['"]/g, // "5291:5291" compose ports
    /--port[= ](\d{2,5})/g,            // --port 5291
    /PORT[A-Z_]*[=:]\s*(\d{2,5})/g,    // INTERNAL_SERVICE_PORT=12345
    /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g, // a bind or URL
  ];
  for (const re of PORT_CONTEXTS) {
    for (const [, port] of text.matchAll(re)) declaredPorts.add(port);
  }
}
const uiPort = readFileSync(join(root, 'docker', 'ui', 'Dockerfile'), 'utf8')
  .match(/^EXPOSE\s+(\d+)/m)?.[1];
if (!uiPort) throw new Error('no EXPOSE in docker/ui/Dockerfile');

// --- source of truth 3: what the containers actually run -------------------
// If a Dockerfile's CMD runs a binary out of /usr/local/bin, then cargo's
// ``Running `target/debug/...` `` line is never emitted for that service.
const runsReleaseBinaries = ['internal-service', 'workspace-server'].every((d) => {
  const p = join(root, 'docker', d, 'Dockerfile');
  return existsSync(p) && /CMD\s+\[.*\/usr\/local\/bin\//s.test(readFileSync(p, 'utf8'));
});

for (const doc of docs) {
  const rel = relative(root, doc);
  readFileSync(doc, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const at = `${rel}:${i + 1}`;

      // Only backticked invocations -- `tilt logs server` is a command;
      // "if tilt logs show errors" is English.
      for (const [, verb, name] of line.matchAll(
        /`\s*tilt\s+(logs|trigger)\s+([a-z][a-z0-9-]*)/gi,
      )) {
        if (name === '<service-name>' || resources.has(name)) continue;
        failures.push(
          `${at}  \`tilt ${verb} ${name}\` names no Tilt resource. ` +
            `The Tiltfile defines: ${[...resources].join(', ')}.`,
        );
      }

      for (const [, port] of line.matchAll(/(?:localhost|127\.0\.0\.1):(\d{4,5})/g)) {
        if (declaredPorts.has(port)) continue;
        failures.push(
          `${at}  names :${port}, which nothing in docker-compose.yml, the ` +
            `Tiltfile or any Dockerfile binds or exposes. The dev UI is on ` +
            `:${uiPort}.`,
        );
      }

      // Only where the line PRESENTS it as the thing to wait for. A sentence
      // explaining that no such line exists must not trip this.
      const asksForIt = /SUCCESS|PASS if|success indicator|waiting for/i.test(line);
      if (runsReleaseBinaries && asksForIt && /Running\s+\\?`?target\/debug\//.test(line)) {
        failures.push(
          `${at}  waits for a \`Running target/debug/...\` line. The containers ` +
            `run release binaries from /usr/local/bin and never log one, so ` +
            `this wait can only ever time out.`,
        );
      }
    });
}

if (failures.length) {
  console.error('Agent instructions name things that do not exist:\n');
  for (const f of failures) console.error('  ' + f);
  console.error(
    '\nThese are executed, not read: a wrong name is a five-minute timeout ' +
      'or a blank page,\nreported as a broken service.',
  );
  process.exit(1);
}

console.log(
  `OK: ${docs.length} agent docs name only real Tilt resources ` +
    `(${[...resources].join(', ')}), only declared ports ` +
    `(${[...declaredPorts].sort().join(', ')}), and no target/debug marker.`,
);
