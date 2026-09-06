#!/usr/bin/env node
/**
 * Every document that tells someone where the UI is must name the port it is
 * actually on.
 *
 * The UI moved from Vite's 5173 default to 5291. Twenty-four references across
 * five `.claude/agents/*.md` files did not move with it, and one of them is a
 * PREREQUISITE CHECK: `basic-p2p-test` curls `http://localhost:5173/` and, on
 * the connection refused it will always get, aborts with "PREREQUISITE FAILED:
 * UI not accessible ... Check if `tilt up` is running and UI service is
 * healthy". So the agent could never run, and its own error sent the operator
 * to restart a stack that was already healthy.
 *
 * The port is DERIVED here, from `vite.config.ts` and the UI Dockerfile, rather
 * than written down: a gate with the number in it is one more copy to drift,
 * and the drift is the defect.
 *
 * Scoped to files that tell a person or an agent what to DO -- the agent
 * definitions and the docs. Source and config are excluded: they are where the
 * port is defined, and a test fixture naming an old port is a fixture, not an
 * instruction.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The port the dev server actually listens on, from the two places that set it. */
function uiPort() {
  const found = new Map();

  const vite = join(ROOT, 'citadel-workspaces/vite.config.ts');
  if (existsSync(vite)) {
    const m = readFileSync(vite, 'utf8').match(/^\s*port:\s*(\d{4,5})\s*,/m);
    if (m) found.set('citadel-workspaces/vite.config.ts', m[1]);
  }

  const dockerfile = join(ROOT, 'docker/ui/Dockerfile');
  if (existsSync(dockerfile)) {
    // The dev stage's EXPOSE, which is the first one; the production stage
    // exposes nginx's 8080 and is a different thing.
    const m = readFileSync(dockerfile, 'utf8').match(/^EXPOSE\s+(\d{4,5})\s*$/m);
    if (m) found.set('docker/ui/Dockerfile', m[1]);
  }

  if (found.size === 0) {
    console.error(
      'check-docs-name-the-real-ui-port: could not read the UI port from ' +
        'vite.config.ts or docker/ui/Dockerfile. Those moved, and this gate has ' +
        'nothing to compare against.',
    );
    process.exit(1);
  }
  const values = [...new Set(found.values())];
  if (values.length > 1) {
    console.error('The UI port disagrees between the places that set it:\n');
    for (const [file, port] of found) console.error(`  ${file} — ${port}`);
    console.error('\n  Docs cannot name one port while the stack serves another.\n');
    process.exit(1);
  }
  return values[0];
}

const PORT = uiPort();

/** Files that instruct a human or an agent. */
function instructionFiles() {
  const files = [];
  const agents = join(ROOT, '.claude/agents');
  if (existsSync(agents)) {
    for (const f of readdirSync(agents)) {
      if (f.endsWith('.md')) files.push(join(agents, f));
    }
  }
  for (const f of readdirSync(ROOT)) {
    if (f.endsWith('.md')) files.push(join(ROOT, f));
  }
  const docs = join(ROOT, 'docs');
  if (existsSync(docs)) {
    for (const f of readdirSync(docs)) {
      if (f.endsWith('.md')) files.push(join(docs, f));
    }
  }
  return files;
}

const files = instructionFiles();
// A gate over no files reports what a gate over clean files reports.
if (files.length < 5) {
  console.error(
    `check-docs-name-the-real-ui-port: only ${files.length} instruction file(s) found; ` +
      'the layout moved and this gate is checking almost nothing.',
  );
  process.exit(1);
}

const problems = [];
let mentions = 0;

for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    // Only a URL or an explicit port, never a bare four-digit number that
    // happens to appear in prose.
    const matches = [...line.matchAll(/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{4,5})/g)];
    for (const m of matches) {
      const port = m[1];
      // Other services have their own ports; this gate is about the UI's.
      // A line naming 5173 is naming Vite's default, which is what drifted.
      if (port !== '5173' && port !== PORT) continue;
      mentions += 1;
      if (port !== PORT) {
        problems.push({ file: relative(ROOT, file), line: i + 1, port, text: line.trim().slice(0, 90) });
      }
    }
  });
}

if (mentions === 0) {
  console.error(
    `check-docs-name-the-real-ui-port: no instruction file names the UI on any host:port, ` +
      'so nothing was compared. Either the docs stopped telling people where the UI is, ' +
      'or the shape this looks for changed.',
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`Instructions point at a port the UI does not serve (it is on ${PORT}):\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line} — :${p.port}\n      ${p.text}`);
  }
  console.error(
    `\n  The UI listens on ${PORT} (citadel-workspaces/vite.config.ts, docker/ui/Dockerfile).\n` +
      '  A prerequisite check against the wrong port fails every time and blames the stack.\n',
  );
  process.exit(1);
}

console.log(
  `check-docs-name-the-real-ui-port: ${mentions} UI URL(s) across ${files.length} ` +
    `instruction file(s) all name ${PORT}.`,
);
