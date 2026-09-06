/**
 * Every Rust type marked for export must have a generated TypeScript file, and
 * every generated file must correspond to one.
 *
 * `typescript-client/src/types/` IS the ts-rs output — there is no separate
 * hand-copy here, so the drift this catches is "somebody added or renamed a
 * `#[cfg_attr(feature = "typescript", ts(export))]` type and did not re-run
 * `generate_types.sh`".
 *
 * Why that is worse than a stale type usually is, in this protocol
 * specifically: no enum carries a version field or a `#[serde(other)]`
 * catch-all, so an unknown variant fails the WHOLE message rather than one
 * field. A client built against stale types does not degrade — it drops
 * responses. The sibling gate `check-generated-types-fresh.mjs` was written for
 * the same hazard in `citadel-workspace-types`, where the copy had drifted six
 * months; this is that mechanism, for the crate it was never applied to.
 *
 * IT DOES NOT COMPARE FIELDS. Regenerating to diff bodies needs a cargo build
 * with the `typescript` feature, which is more than a lint should cost. The
 * name-level check catches the realistic drift — a variant added, the types not
 * regenerated — and `check-generated-types-are-all-exported` covers the other
 * half, that a generated file is reachable at all.
 *
 * SELF-TESTED, because its population is empty today. Zero findings means
 * nothing unless the detector is known to still fire, which is the lesson this
 * record has now learned from four separate gates.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUST = join(
  ROOT, 'citadel-internal-service', 'citadel-internal-service-types', 'src', 'lib.rs',
);
const TYPES = join(ROOT, 'citadel-internal-service', 'typescript-client', 'src', 'types');

/**
 * Types the crate marks for export.
 *
 * The attribute is `#[cfg_attr(feature = "typescript", ts(export))]`, not a bare
 * `#[ts(export)]` — a pattern written for the latter matches NOTHING here, and
 * reports every generated file as an orphan. That was this gate's first run.
 */
function exportedTypes(source) {
  const found = new Set();
  const re = /ts\(export\)\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:struct|enum)\s+(\w+)/g;
  let m;
  while ((m = re.exec(source)) !== null) found.add(m[1]);
  return found;
}

// --- self-test -------------------------------------------------------------
const FIXTURE = `
#[derive(Serialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SomeNotification { pub cid: u64 }

#[cfg_attr(feature = "typescript", ts(export))]
pub enum SomeCommand { A, B }

// Not exported, so not expected on disk.
pub struct Internal { pub x: u8 }
`;
{
  const found = exportedTypes(FIXTURE);
  const failures = [];
  for (const want of ['SomeNotification', 'SomeCommand']) {
    if (!found.has(want)) failures.push(`missed ${want}`);
  }
  if (found.has('Internal')) failures.push('claimed the unexported `Internal`');
  if (failures.length > 0) {
    console.error('FAIL: this gate no longer recognises an exported type.\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nThe attribute shape moved, so a scan of the real source would report every generated\n' +
        'file as an orphan — or nothing at all. Checked here first because the tree has no\n' +
        'drift today, and a detector with nothing to detect proves nothing about itself.',
    );
    process.exit(1);
  }
}

// --- the tree --------------------------------------------------------------
if (!existsSync(RUST) || !existsSync(TYPES)) {
  console.error(
    `FAIL: ${relative(ROOT, existsSync(RUST) ? TYPES : RUST)} is not present, so this gate\n` +
      'examined nothing. Run `git submodule update --init --recursive` first.',
  );
  process.exit(1);
}

const exported = exportedTypes(readFileSync(RUST, 'utf8'));
const generated = new Set(
  readdirSync(TYPES)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, '')),
);

// Vacuity floor: this crate exports a hundred types. A small number means the
// attribute shape moved and the comparison below is over nothing.
if (exported.size < 50) {
  console.error(
    `FAIL: found only ${exported.size} exported type(s) in the Rust source; the attribute\n` +
      'shape moved, so this gate compared almost nothing.',
  );
  process.exit(1);
}

const missing = [...exported].filter((t) => !generated.has(t)).sort();
const orphaned = [...generated].filter((t) => !exported.has(t)).sort();

if (missing.length > 0 || orphaned.length > 0) {
  for (const t of missing) {
    console.error(`::error::${t} is exported by the Rust crate but has no generated .ts file`);
  }
  for (const t of orphaned) {
    console.error(`::error::${t}.ts exists but no Rust type is marked for export under that name`);
  }
  console.error(`\nFAIL: ${missing.length} ungenerated and ${orphaned.length} orphaned type(s).\n`);
  console.error(
    'Run `./generate_types.sh` from the agent repo root.\n' +
      '\nNo enum in this protocol carries a version field or a serde catch-all, so an unknown\n' +
      'variant fails the WHOLE message rather than one field. A client built against stale\n' +
      'types does not degrade — it drops responses.',
  );
  process.exit(1);
}

console.log(
  `check-wire-types-match-the-rust: ${exported.size} exported Rust type(s), ` +
    `${generated.size} generated file(s), names agree in both directions ` +
    '(detector self-tested first).',
);
