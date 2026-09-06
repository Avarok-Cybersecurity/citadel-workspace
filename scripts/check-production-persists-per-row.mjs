/**
 * Production must not run the backend that rewrites everything per write.
 *
 * `WORKSPACE_BACKEND=filesystem` selects the SDK's FileIOBackend. Its
 * `store_byte_map_value` calls `save_cnac_by_cid`, which serialises the whole
 * `ClientNetworkAccount` and writes the file -- and for this server that
 * account's byte map IS the entire store: every document's mdx_content, every
 * user record, every message page.
 *
 * So the cost of a write is the size of the DATABASE, not the size of the
 * value:
 *
 *   one chat message          1-3 x whole database
 *   editing an old message    pages+1 x whole database (41x at 10k messages)
 *   a new user's first connect 6 x whole database
 *
 * At an 80 MB store that is 100-300 MB of serialisation and disk write per
 * message. It is invisible in development, where the seeded content is about
 * seven kilobytes, and invisible to the kernel's own tests, which run on
 * `test_storage` and bypass the SDK entirely.
 *
 * `sqlite` does a per-row SELECT/INSERT on a bytemap table instead.
 *
 * Checked as text rather than parsed: this must run on a bare checkout, and a
 * gate that needs js-yaml can only run where dependencies are installed.
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

const lines = readFileSync(path, 'utf8').split('\n');
const settings = [];
lines.forEach((line, i) => {
  const match = line.match(/^\s*-?\s*WORKSPACE_BACKEND\s*=\s*(\S+)/);
  if (match) settings.push({ line: i + 1, value: match[1] });
});

if (settings.length === 0) {
  console.error(
    `FAIL: ${FILE} sets no WORKSPACE_BACKEND. Without it the server runs the\n` +
      'IN-MEMORY backend and every account, document and message is lost on\n' +
      'restart — which is worse than the slow one this gate exists to prevent.',
  );
  process.exit(1);
}

const bad = settings.filter((s) => s.value === 'filesystem');
if (bad.length > 0) {
  for (const s of bad) {
    console.error(
      `::error file=${FILE},line=${s.line}::WORKSPACE_BACKEND=filesystem rewrites the entire database on every write`,
    );
  }
  console.error(`\nFAIL: production is on the filesystem backend.\n`);
  for (const s of bad) console.error(`  ${FILE}:${s.line}  WORKSPACE_BACKEND=filesystem`);
  console.error(
    '\nUse `sqlite`. filesystem serialises and rewrites the WHOLE store on every\n' +
      'write, so one chat message costs a write of every document and every\n' +
      'message page. It is a development backend.',
  );
  process.exit(1);
}

console.log(
  `check-production-persists-per-row: ${settings.length} WORKSPACE_BACKEND setting(s) in ` +
    `${FILE}, none on the filesystem backend (${settings.map((s) => s.value).join(', ')}).`,
);
