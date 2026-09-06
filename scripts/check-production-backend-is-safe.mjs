/**
 * Production must not select a backend that loses writes.
 *
 * This gate previously required the opposite of what it requires now, and the
 * reversal is the point.
 *
 * `filesystem` is the SDK's FileIOBackend. Every write serialises and rewrites
 * the WHOLE account file, and for this server that file is the entire store —
 * every document body, every user, every message page. One chat message costs
 * one to three writes of the whole database. That is a genuine ceiling, and
 * this gate was written to push production off it.
 *
 * `sqlite` was the obvious answer and is WRONG, in a way that reading the
 * compose comment would not tell you. In the pinned SDK:
 *
 *   - `bytemap` is created with no PRIMARY KEY, no UNIQUE, and no index on
 *     (cid, peer_cid, id, sub_id);
 *   - `store_byte_map_value` is a bare INSERT with no ON CONFLICT — it never
 *     updates or deletes;
 *   - `get_byte_map_value` is `SELECT bin ... LIMIT 1` with NO ORDER BY.
 *
 * So every save appends a row and every read returns an arbitrary one.
 * Reproduced directly: three writes to one key leave three rows and read back
 * the FIRST. On sqlite an update is silently invisible.
 *
 * Slow and correct beats fast and wrong, so this now REFUSES sqlite and
 * accepts filesystem. Lifting it needs a fix in citadel-protocol — a unique
 * index on those four columns and an upsert — not a change here.
 *
 * It also refuses the setting being absent, which selects the in-memory
 * backend and loses everything on restart.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'docker-compose.production.yml';
const path = join(ROOT, FILE);

if (!existsSync(path)) {
  console.error(`FAIL: ${FILE} not found — nothing to check.`);
  process.exit(1);
}

/** Backends that lose data, with what each loses. */
const UNSAFE = new Map([
  ['sqlite', 'appends instead of updating; reads return an arbitrary row, so updates are invisible'],
  ['postgres', 'same SDK SQL backend as sqlite: no unique constraint, bare INSERT, unordered read'],
  ['mysql', 'same SDK SQL backend as sqlite: no unique constraint, bare INSERT, unordered read'],
]);

const lines = readFileSync(path, 'utf8').split('\n');
const settings = [];
lines.forEach((line, i) => {
  const match = line.match(/^\s*-?\s*WORKSPACE_BACKEND\s*=\s*(\S+)/);
  if (match) settings.push({ line: i + 1, value: match[1] });
});

if (settings.length === 0) {
  console.error(
    `FAIL: ${FILE} sets no WORKSPACE_BACKEND. Without it the server runs the\n` +
      'IN-MEMORY backend and every account, document and message is lost on restart.',
  );
  process.exit(1);
}

const bad = settings.filter((s) => UNSAFE.has(s.value));
if (bad.length > 0) {
  for (const s of bad) {
    console.error(`::error file=${FILE},line=${s.line}::WORKSPACE_BACKEND=${s.value} — ${UNSAFE.get(s.value)}`);
  }
  console.error(`\nFAIL: production selects a backend that loses writes.\n`);
  for (const s of bad) console.error(`  ${FILE}:${s.line}  ${s.value} — ${UNSAFE.get(s.value)}`);
  console.error(
    '\nUse `filesystem` until the SDK gains a unique index on\n' +
      'bytemap(cid, peer_cid, id, sub_id) and an upsert. It is slow — every write\n' +
      'rewrites the whole store — but it does not lose data, and that is the\n' +
      'trade to make.',
  );
  process.exit(1);
}

console.log(
  `check-production-backend-is-safe: ${settings.length} WORKSPACE_BACKEND setting(s) in ` +
    `${FILE}, none on a backend that loses writes (${settings.map((s) => s.value).join(', ')}).`,
);
