#!/usr/bin/env node
/**
 * A network fetch in an image build is retried.
 *
 * `docker/sync/Dockerfile` installed wasm-pack with a single
 * `curl … init.sh | sh`. A CI run died on `curl: (35) Recv failure: Connection
 * reset by peer` and took `test:tree-move` with it — a red job carrying no
 * test signal at all, because every integration job depends on that image
 * building.
 *
 * The retry idiom already existed. `docker/ui/Dockerfile` wrote it twice, for
 * `npm install`, with a comment explaining that the registry can be
 * mid-publish. The same file then ran `npm install` twice more without it, and
 * two other Dockerfiles fetched from the network with none at all.
 *
 * So: a RUN line that downloads something must be inside a `for attempt` loop.
 *
 * `apt-get` is deliberately out of scope. It retries within itself, reads from
 * mirrors, and wrapping it would mean re-running `apt-get update` on every
 * attempt for no benefit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Commands that reach the network for one artifact from one host. */
const FETCHES = /\b(?:curl|wget|npm\s+(?:install|ci)|cargo\s+install|rustup\s+(?:component\s+add|target\s+add|toolchain\s+install))\b/;
const RETRIES = /for\s+attempt\s+in/;

function dockerfiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'target' || entry === '.git') continue;
    const full = join(dir, entry);
    // lstat, and tolerant: this tree carries broken symlinks under the
    // typescript-client, and a gate that throws on one is a gate nobody keeps.
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) dockerfiles(full, out);
    else if (/^Dockerfile(\..+)?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Each RUN instruction as one logical line, with the line it starts on. */
function runInstructions(source) {
  const lines = source.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*RUN\b/.test(lines[i])) continue;
    let text = lines[i];
    let j = i;
    while (/\\\s*$/.test(lines[j]) && j + 1 < lines.length) {
      j += 1;
      text += `\n${lines[j]}`;
    }
    found.push({ line: i + 1, text });
    i = j;
  }
  return found;
}

const offenders = [];
for (const file of dockerfiles(ROOT)) {
  const source = readFileSync(file, 'utf-8');
  for (const run of runInstructions(source)) {
    // apt-get is out of scope; a line that only apt-gets is not a fetch here.
    const withoutApt = run.text.replace(/apt-get[^\n&|]*/g, '');
    if (!FETCHES.test(withoutApt)) continue;
    if (RETRIES.test(run.text)) continue;
    offenders.push([relative(ROOT, file), run.line, run.text.split('\n')[0].trim().slice(0, 100)]);
  }
}

if (offenders.length > 0) {
  console.error('\n  Image builds fetching from the network without a retry:\n');
  for (const [file, line, text] of offenders) {
    console.error(`::error file=${file},line=${line}::${text}`);
  }
  console.error(
    '\n  Wrap it in the idiom docker/ui/Dockerfile already uses:\n\n' +
    '    RUN for attempt in 1 2 3 4 5; do \\\n' +
    '          <the command> && break; \\\n' +
    '          echo "… failed (attempt $attempt/5); retrying in $((attempt * 20))s"; \\\n' +
    '          sleep $((attempt * 20)); \\\n' +
    '        done; \\\n' +
    '        <a verification step>\n\n' +
    '  One reset connection here is a red CI job with no test output.\n',
  );
  process.exit(1);
}

console.log('  Image fetches: every network download in a Dockerfile is retried  ok');
