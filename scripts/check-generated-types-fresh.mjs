#!/usr/bin/env node
/**
 * The hand-copied TypeScript bindings must match the generated ones.
 *
 * `citadel-workspace-types` emits TS bindings via ts-rs into its own
 * `bindings/` directory. `citadel-workspace-client-ts` — the package the UI
 * actually compiles against — holds a COPY under `src/types/generated/`, and
 * nothing automated the copy: sync-wasm-clients.sh has a step for
 * citadel-internal-service-types and none for this crate.
 *
 * So the copy drifted six months. The client was missing `Permission::Themes`,
 * `DomainPermissions.themes` and the whole `UpdateWorkspaceTheme` request
 * variant — every type the theming feature added. tsc could not see it,
 * because `toWasmWorkspaceRequest` casts through `as unknown as`.
 *
 * That matters more than a stale type usually would: no protocol enum carries
 * a version field or a `#[serde(other)]` catch-all, so an unknown variant
 * fails the WHOLE message rather than one field. A client built against stale
 * types does not degrade — it drops responses.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATED = 'citadel-workspace-types/bindings';
const COPY = 'citadel-workspace-client-ts/src/types/generated';

const generated = readdirSync(GENERATED).filter((f) => f.endsWith('.ts')).sort();
const copied = readdirSync(COPY).filter((f) => f.endsWith('.ts')).sort();

const problems = [];

for (const file of generated) {
  if (!copied.includes(file)) {
    problems.push(`${file}: generated but missing from the client copy`);
    continue;
  }
  const a = readFileSync(join(GENERATED, file), 'utf8');
  const b = readFileSync(join(COPY, file), 'utf8');
  if (a !== b) problems.push(`${file}: differs from the generated version`);
}
for (const file of copied) {
  if (!generated.includes(file)) problems.push(`${file}: in the client copy but no longer generated`);
}

if (problems.length > 0) {
  console.error('The client TypeScript bindings are out of sync with the Rust types:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nRefresh them:  cp ${GENERATED}/*.ts ${COPY}/`);
  console.error('\nThis is not cosmetic. No protocol enum has a version field or a');
  console.error('serde(other) catch-all, so a variant the client does not know fails the');
  console.error('whole message — the client drops responses rather than degrading.');
  process.exit(1);
}

console.log(`Client bindings match the generated types (${generated.length} files).`);
