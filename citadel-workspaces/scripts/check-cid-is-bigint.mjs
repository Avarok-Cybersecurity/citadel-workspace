/**
 * A CID is a `bigint`, and a declared field that names one may not be a string.
 *
 * CLAUDE.md is explicit, and has been since the u64-to-bigint work:
 *
 *   CID canonical type is `bigint`. Convert to string ONLY when necessary:
 *   React JSX display, React keys, debug logging. NEVER use string CIDs in
 *   function parameters, interface definitions, Map/Set keys, or serialization
 *   boundaries.
 *
 * Seventy-six declared and inline field types do. None carries a comment saying why, and the
 * code around them argues against it: `usePeerDiscovery` calls `.toString()` on
 * CIDs that arrive as bigint, so the canonical value is there and is being
 * thrown away.
 *
 * The cost is not theoretical. There are two `Peer` types in this app —
 * `p2p-registration-service` with `cid: bigint`, `usePeerDiscovery` with
 * `cid: string` — for the same peers, differing in that field and in whether
 * "online" is `isOnline` or `is_online`. They are not assignable to each other,
 * so every crossing needs a conversion, and a conversion that is forgotten is a
 * comparison that silently never matches. `normalizeCid` truncating to the last
 * ten digits, recorded in this repo's notes, is the same family of bug.
 *
 * ## A ratchet, because forty-eight cannot be fixed in one change
 *
 * Per-file baseline: a file may not gain a string CID, a file not in the
 * baseline must have none, and any file that improves is written down to its
 * new number immediately. New code is correct from today; the rest burns down.
 * The same shape as check-explicit-types, which went from 7,823 to zero.
 *
 * The baseline is a record of debt, not a permission slip.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(APP, 'scripts/cid-is-bigint.baseline.json');
const WRITE = process.argv.includes('--write');

/**
 * A declared field whose name is a CID, typed string.
 *
 * Deliberately only the DECLARATION form `name: string;`. A `Map<string, T>`
 * keyed by a stringified CID is a different argument, a local variable holding
 * one for a React key is explicitly allowed by the rule above, and matching
 * either would make this fire on the cases CLAUDE.md permits.
 */
const STRING_CID = /^\s*(?:readonly\s+)?(\w*(?:[Cc]id|_cid))\??\s*:\s*string\s*;/;

/**
 * The same thing written inline: `Array<{ cid: string; … }>`,
 * `(value: { cid: string }) => void`, a return type on one line.
 *
 * Counted, because the first version of this gate matched only the declaration
 * form and missed 28 of 76 — including one in the very file used to size the
 * problem, two lines below a field it did catch. A gate that sees one spelling
 * of a rule reports the codebase as cleaner than it is, which is worse than not
 * having it: round 343 was that exact mistake in the dependency gate.
 */
const STRING_CID_INLINE = /\{[^{}]*\b\w*(?:[Cc]id|_cid)\??\s*:\s*string\s*[;,}]/;

const SKIP = new Set(['node_modules', 'dist', '__tests__']);

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try { info = statSync(full); } catch { continue; }
    if (info.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = sources(join(APP, 'src'));
if (files.length < 100) {
  console.error(`\n  Scanned only ${files.length} file(s) — the layout moved.\n`);
  process.exit(1);
}

/** `{ 'src/x.ts': 3 }` — files with none are absent. */
const counts = {};
for (const file of files) {
  const found = readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => STRING_CID.test(line) || STRING_CID_INLINE.test(line)).length;
  if (found > 0) counts[relative(APP, file)] = found;
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (WRITE) {
  const previous = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {};
  const raised = Object.entries(counts).filter(([file, n]) => n > (previous[file] ?? 0));
  if (raised.length > 0 && !process.argv.includes('--allow-regressions')) {
    console.error(`\n  Refusing to write: ${raised.length} file(s) would go UP.\n`);
    for (const [file, n] of raised.slice(0, 10)) console.error(`    ${file}: ${previous[file] ?? 0} → ${n}`);
    process.exit(1);
  }
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`  Baseline written: ${Object.keys(counts).length} file(s), ${total} field(s).`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('\n  No baseline. Run `node scripts/check-cid-is-bigint.mjs --write` once.\n');
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
const baselineTotal = Object.values(baseline).reduce((sum, n) => sum + n, 0);

const regressions = [];
const improvements = [];
for (const [file, found] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0;
  if (found > allowed) {
    regressions.push(
      allowed === 0
        ? `${file}: ${found} string CID field(s), in a file that had none`
        : `${file}: ${found} string CID field(s), up from ${allowed}`,
    );
  } else if (found < allowed) improvements.push(`${file}: ${allowed} → ${found}`);
}
for (const file of Object.keys(baseline)) {
  if (!(file in counts)) improvements.push(`${file}: ${baseline[file]} → 0`);
}

if (regressions.length > 0) {
  console.error('\n  CID fields declared as string:\n');
  for (const r of regressions) console.error(`::error::${r}`);
  console.error(
    '\n  A CID is a bigint. Convert to string only where CLAUDE.md allows —\n' +
    '  JSX display, React keys, debug logging — and never in the declaration.\n',
  );
  process.exit(1);
}

if (improvements.length > 0) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.error(`\n  ${improvements.length} file(s) improved and the baseline has been updated:\n`);
  for (const i of improvements.slice(0, 10)) console.error(`    ${i}`);
  console.error(`\n  String CIDs: ${baselineTotal} → ${total}. Commit the baseline.\n`);
  process.exit(1);
}

console.log(`  CID typing: no new string CIDs (${total} in the baseline, burning down)  ok`);
