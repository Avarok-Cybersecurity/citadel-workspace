/**
 * Production must select a persistent backend the server actually accepts.
 *
 * History, because this gate has now been wrong twice:
 *
 *   1. It once pushed production OFF `filesystem` (every write rewrites the
 *      whole store) and then, finding sqlite's `bytemap` appended instead of
 *      updating, reversed itself and refused sqlite.
 *   2. Citadel-Protocol #305 fixed `bytemap` (upsert, unique key, tested), the
 *      lock pins its merge commit `4c1ba46`, and production has run sqlite
 *      since (ROBUSTNESS round 748: 22/22 on the sqlite deployment). But this
 *      gate never noticed, because it could not see the value. Compose says
 *      `WORKSPACE_BACKEND=${WORKSPACE_BACKEND:-sqlite}`, the old regex took the
 *      whole `${...}` string as the value, found it on no list, and passed —
 *      printing `${WORKSPACE_BACKEND:-sqlite}` as the backend it had checked.
 *
 * So it now resolves what actually runs: a literal value as written; for
 * `${VAR:-default}` the default, which is what a deployment gets when the
 * operator sets nothing. A reference with no default is refused, because
 * nothing here can say what it resolves to. The resolved value must be one the
 * server accepts — read from the server's own match, not listed here — and an
 * absent or empty setting is refused: the server then runs IN-MEMORY and loses
 * every account, document and message on restart.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'docker-compose.production.yml';
const SERVER = 'citadel-workspace-server-kernel/src/lib.rs';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

for (const f of [FILE, SERVER]) {
  if (!existsSync(join(ROOT, f))) fail(`${f} not found — nothing to check.`);
}

// The backends the server accepts are the `Some("<name>") =>` arms of the
// function that raises "Unknown backend type". Read them rather than list them,
// and only from that function, so an unrelated match elsewhere cannot widen them.
const server = readFileSync(join(ROOT, SERVER), 'utf8');
const unknown = server.indexOf('Unknown backend type');
if (unknown < 0) fail(`${SERVER} no longer raises "Unknown backend type"; find where backends are chosen.`);
const backendFn = server.slice(server.lastIndexOf('fn ', unknown), unknown);
const accepted = new Set([...backendFn.matchAll(/Some\("([a-z]+)"\)\s*=>/g)].map((m) => m[1]));
if (accepted.size === 0) fail(`found no backend arms before "Unknown backend type" in ${SERVER}.`);

const settings = [];
readFileSync(join(ROOT, FILE), 'utf8')
  .split('\n')
  .forEach((line, i) => {
    const match = line.match(/^\s*-?\s*WORKSPACE_BACKEND\s*=\s*(\S*)/);
    if (match) settings.push({ line: i + 1, raw: match[1] });
  });

if (settings.length === 0) {
  fail(`${FILE} sets no WORKSPACE_BACKEND, so the server runs IN-MEMORY and loses everything on restart.`);
}

function resolve(raw) {
  const ref = raw.match(/^\$\{([A-Z_][A-Z0-9_]*)(?::?-([^}]*))?\}$/);
  if (!ref) return { value: raw };
  if (ref[2] === undefined) return { error: `${raw} has no default; nothing here can say what it resolves to` };
  return { value: ref[2] };
}

const problems = [];
for (const s of settings) {
  const { value, error } = resolve(s.raw);
  s.value = value;
  if (error) problems.push({ ...s, why: error });
  else if (value === '') problems.push({ ...s, why: 'resolves to empty: the server runs IN-MEMORY and loses everything on restart' });
  else if (!accepted.has(value)) problems.push({ ...s, why: `'${value}' is not a backend the server accepts (${[...accepted].join(', ')}); it would refuse to start` });
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=${FILE},line=${p.line}::WORKSPACE_BACKEND=${p.raw} — ${p.why}`);
  fail(`production's backend setting does not resolve to a persistent backend the server accepts.`);
}

console.log(
  `check-production-backend-is-safe: ${settings.map((s) => `${s.raw} resolves to '${s.value}'`).join('; ')} ` +
    `— accepted by the server (${[...accepted].join(', ')}).`,
);
