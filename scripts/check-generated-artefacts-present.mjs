#!/usr/bin/env node
/**
 * The checks that follow consume generated artefacts. Say so before they fail.
 *
 * CLAUDE.md documents the build order: `citadel-internal-service/typescript-client`
 * (WASM types), then `citadel-workspace-client-ts`, then typecheck. Skip it and
 * the failures are real but misleading — eight errors of the form "Property 'id'
 * does not exist on type 'GroupMessage'", because `GroupMessage` comes from the
 * WASM bindings, plus "Cannot find module 'citadel-workspace-client-ts'".
 *
 * Every one of those is a true statement about an unbuilt tree, and not one of
 * them says "you have not built the tree". Someone reading them reasonably
 * concludes the source is broken; I did exactly that against a clean checkout of
 * master, whose own CI had typechecked it green minutes earlier.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each artefact, what produces it, and what breaks without it. */
const REQUIRED = [
  {
    path: 'citadel-internal-service/citadel-internal-service-wasm-client/pkg/citadel_internal_service_wasm_client.d.ts',
    produced_by: './sync-wasm-clients.sh',
    without_it: 'types from the WASM bindings (GroupMessage, CID shapes) resolve to nothing',
  },
  {
    path: 'citadel-workspace-client-ts/dist/index.d.ts',
    produced_by: 'npm run build -w citadel-workspace-client-ts',
    without_it: "imports of 'citadel-workspace-client-ts' cannot resolve",
  },
];

const missing = REQUIRED.filter((artefact) => !existsSync(join(ROOT, artefact.path)));

if (missing.length > 0) {
  console.error('Generated artefacts are missing, so the checks after this one cannot mean anything:\n');
  for (const artefact of missing) {
    console.error(`  - ${artefact.path}`);
    console.error(`      produced by: ${artefact.produced_by}`);
    console.error(`      without it:  ${artefact.without_it}\n`);
  }
  console.error('See CLAUDE.md, "CI Build Order". Build these first, then re-run.');
  process.exit(1);
}

console.log(`Generated artefacts OK: ${REQUIRED.length} present.`);
