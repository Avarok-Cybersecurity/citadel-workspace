#!/usr/bin/env node
/**
 * The global app catalogue lists only apps the kernel would install, once per id.
 *
 * apps/catalogue/catalogue.json is what every workspace's marketplace lists, served same-origin
 * with the UI. An entry the kernel would refuse lists an app nobody can
 * install; two entries for one id list one of them at random; a module importing a group its
 * manifest does not open is refused at install, after a person has read and accepted the consent
 * screen for it. All three are decided here, before the file ships.
 *
 * Reading uses the UI's rules (scripts/lib/app-catalogue-rules.mjs); the checks are
 * scripts/lib/app-catalogue.mjs, tested by scripts/lib/app-catalogue.test.mjs.
 *
 * Signatures: no ML-DSA-65 verifier runs here, so each is counted as unchecked and the kernel
 * verifies it when it fetches the listing; the verifier is a parameter of the check, so one can
 * be passed in without changing it. Modules: checked when `apps/catalogue/artifacts/<sha256>.wasm`
 * is present and the ABI constants are in this tree; each one not to hand is counted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogueRules } from './lib/app-catalogue-rules.mjs';
import { checkCatalogue, readAbiConstants } from './lib/app-catalogue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = join(ROOT, 'apps/catalogue/catalogue.json');
const ARTIFACTS = join(ROOT, 'apps/catalogue/artifacts');
const ABI = join(ROOT, 'citadel-internal-service/citadel-app-sdk-types/bindings/AbiConstants.ts');

if (!existsSync(CATALOGUE)) {
  console.error('check-app-catalogue: apps/catalogue/catalogue.json is missing, so nothing was checked.');
  process.exit(1);
}

let abi = null;
if (existsSync(ABI)) {
  abi = readAbiConstants(readFileSync(ABI, 'utf8'));
  if (abi === null) {
    console.error(`check-app-catalogue: ${ABI} no longer has the constants this check reads.`);
    process.exit(1);
  }
}

const result = checkCatalogue(readFileSync(CATALOGUE, 'utf8'), {
  rules: await loadCatalogueRules(),
  verifySignature: () => 'unchecked',
  artifactFor: (manifest) => {
    const path = join(ARTIFACTS, `${manifest.artifact.sha256}.wasm`);
    return existsSync(path) ? readFileSync(path) : null;
  },
  abi,
});

if (result.problems.length > 0) {
  for (const problem of result.problems) console.error(`apps/catalogue/catalogue.json: ${problem}`);
  process.exit(1);
}
console.log(
  `check-app-catalogue: ${result.entries} entries read; ${result.signatures.unchecked} signatures left to the kernel; ` +
  `${result.modules.checked} modules checked against their manifests, ${result.modules.notToHand} not to hand` +
  `${abi === null ? ' (the ABI constants are not in this tree)' : ''}.`,
);
