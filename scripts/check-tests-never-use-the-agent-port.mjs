#!/usr/bin/env node
/**
 * Tests never use the agent's own port.
 *
 * A developer's installed agent listens on the agent port (citadel-app-net-policy's AGENT_PORT,
 * 12345) on the machine the hooks run on. A test or gate that binds it fails with AddrInUse while
 * that agent runs, or takes the port from it when it does not; one that dials it talks to the
 * developer's real agent, signed-in accounts and all. Neither may depend on the port being free or
 * taken. Tests take a claimed port (citadel-internal-service/tests/common/src/ports.rs, which
 * refuses at compile time to hand this one out) or one the OS assigns.
 *
 * This reads every place a test, a test helper, a gate or a test-reachable default lives, in this
 * repository and in the agent submodule (`git ls-files --recurse-submodules`), and fails on the
 * agent port named as an address: `host:12345`, a port setting of 12345, a `?? 12345` fallback, or
 * AGENT_PORT itself in Rust test code. Each remaining use is a fixture, listed below with its
 * reason and its exact count, so a new use in a listed file fails as surely as one elsewhere, and a
 * fixture that is removed shrinks the list. A gate whose job is to dial the developer's running
 * stack is listed as such, and must not be invoked from any workflow or hook.
 *
 * Not read: citadel-workspaces/integration-tests/, the Playwright suite that drives the Docker
 * stack, whose agent is on this port by design; it runs only in CI's stack jobs (and never on a
 * developer machine, by the lane rules). Docs, shell and YAML do not run in a test process.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED, DIALS_THE_STACK } from './lib/agent-port-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = 'citadel-internal-service';
const POLICY = `${AGENT}/citadel-app-net-policy/src/lib.rs`;

const port = /pub const AGENT_PORT: u16 = (\d+);/.exec(readFileSync(join(ROOT, POLICY), 'utf8'))?.[1];
if (port === undefined) {
  console.error(`check-tests-never-use-the-agent-port: no \`pub const AGENT_PORT: u16\` in ${POLICY}; nothing to look for.`);
  process.exit(1);
}

const files = execFileSync('git', ['ls-files', '--recurse-submodules'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
if (!files.some((f) => f.startsWith(`${AGENT}/`))) {
  console.error(`check-tests-never-use-the-agent-port: ${AGENT}/ lists no files; run \`git submodule update --init --recursive\`.`);
  process.exit(1);
}

const RUST_TEST_FILE = /(^|\/)tests?\/|_tests?\.rs$|(^|\/)tests?_[^/]*\.rs$|test_support[^/]*\.rs$/;
const SCRIPT = /^(scripts|citadel-workspaces\/scripts|citadel-internal-service\/\.github\/scripts|deploy\/[^/]+\/test)\/.*\.(mjs|js|ts)$/;
const UI_TEST = /^(citadel-workspaces|citadel-workspace-client-ts)\/src\/.*(__tests__\/|\.test\.)[^/]*$|^citadel-workspaces\/src\/test\//;
const CONFIG = new Set(['citadel-workspaces/vite.config.ts', 'citadel-workspaces/vitest.config.ts']);
const SKIPPED = /^citadel-workspaces\/integration-tests\/|\/examples\/|(^|\/)node_modules\//;

/** Line numbers inside `#[cfg(test)] mod name { ... }` blocks (a `mod name;` is its own file). */
function inlineTestModules(lines) {
  const inside = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*#\[cfg\(test\)\]/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && /^\s*#\[/.test(lines[j])) j += 1;
    if (!/^\s*(pub(\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(lines[j] ?? '')) continue;
    let depth = 0;
    for (let k = j; k < lines.length; k += 1) {
      inside.add(k);
      depth += (lines[k].match(/\{/g) ?? []).length - (lines[k].match(/\}/g) ?? []).length;
      if (depth <= 0) { i = k; break; }
    }
  }
  return inside;
}

/** The lines of `path` that run in a test process or decide what one reaches, with whether it is Rust. */
function scope(path, text) {
  const lines = text.split('\n');
  const all = new Set(lines.keys());
  if (path.endsWith('.rs')) return { lines, rows: RUST_TEST_FILE.test(path) ? all : inlineTestModules(lines), rust: true };
  if (SCRIPT.test(path) || UI_TEST.test(path) || CONFIG.has(path)) return { lines, rows: all, rust: false };
  return null;
}

const P = `${port}(?!\\d)`;
const HOST = String.raw`(?:\/\/[^\s/'"\x60]*|localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|[\w-]+(?:\.[\w-]+)+|\})`;
const AS_ADDRESS = [
  new RegExp(`${HOST}:${P}`), // ws://agent:P, localhost:P, 127.0.0.1:P, [::1]:P, a.example:P, ${host}:P
  new RegExp(`port\\w*['"\x60]?\\s*(?::|=|,|\\(|\\?\\?|=>)\\s*['"\x60]?${P}`, 'i'), // port: P, AGENT_PORT ?? 'P'
  new RegExp(`\\?\\?\\s*['"\x60]?${P}|unwrap_or\\(\\s*${P}|default_value\\s*=\\s*"[^"]*${P}`), // fallbacks
  new RegExp(`SocketAddr::\\w+\\(.*,\\s*${P}\\s*\\)|\\(\\s*(?:\\[[\\d,\\s]+\\]|"[^"]*")\\s*,\\s*${P}\\s*\\)`), // (ip, P)
];
const AGENT_PORT_SYMBOL = /\bAGENT_PORT\b/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

const found = new Map();
let scanned = 0;
for (const path of files) {
  if (SKIPPED.test(path) || !/\.(rs|mjs|js|ts|tsx)$/.test(path)) continue;
  let text;
  try {
    text = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    continue; // listed but deleted in the working tree: nothing there to run
  }
  const s = scope(path, text);
  if (s === null) continue;
  scanned += 1;
  for (const i of s.rows) {
    // A comment cannot bind a socket: whole-line ones, and a trailing ` // ...` (a URL's `://` is not one).
    const line = s.lines[i].replace(/\s\/\/\s.*$/, '');
    if (COMMENT.test(line)) continue;
    const named = AS_ADDRESS.some((re) => re.test(line)) || (s.rust && AGENT_PORT_SYMBOL.test(line));
    if (!named) continue;
    if (!found.has(path)) found.set(path, []);
    found.get(path).push({ line: i + 1, text: s.lines[i].trim() });
  }
}

const problems = [];
for (const [path, uses] of found) {
  const allowed = ALLOWED.get(path) ?? DIALS_THE_STACK.get(path);
  if (allowed === undefined) {
    for (const u of uses) problems.push(`${path}:${u.line}: names the agent port: ${u.text}`);
  } else if (allowed.uses !== uses.length) {
    problems.push(`${path}: ${uses.length} use(s) of the agent port, the fixture list allows ${allowed.uses} ` +
      `(${allowed.why}):\n${uses.map((u) => `      ${u.line}: ${u.text}`).join('\n')}`);
  }
}
for (const [path, allowed] of [...ALLOWED, ...DIALS_THE_STACK]) {
  if (!found.has(path)) problems.push(`${path}: listed with ${allowed.uses} fixture use(s), and has none; remove the entry`);
}
const callers = files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$|^\.githooks\//.test(f));
for (const path of DIALS_THE_STACK.keys()) {
  const name = path.split('/').pop();
  for (const caller of callers) {
    if (readFileSync(join(ROOT, caller), 'utf8').includes(name)) {
      problems.push(`${caller} invokes ${path}, which dials the developer's running agent; a hook or CI must never run it`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Tests or gates that use the agent's own port (${port}):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    '\n  Take a claimed port instead (citadel-internal-service-test-common\'s get_free_port), or bind\n' +
      '  127.0.0.1:0 and keep the listener. A pure string fixture goes in scripts/lib/agent-port-fixtures.mjs\n' +
      '  with the reason nothing binds or dials it.\n',
  );
  process.exit(1);
}
const fixtures = [...found.values()].reduce((n, u) => n + u.length, 0);
console.log(`  ${scanned} test, gate and config file(s) read; port ${port} appears only as ${fixtures} listed fixture use(s) in ${found.size} file(s)  ok`);
