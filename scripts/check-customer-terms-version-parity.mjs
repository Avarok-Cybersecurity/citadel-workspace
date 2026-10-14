#!/usr/bin/env node
/**
 * The Customer Terms version is declared in the crate (the SSOT, beside the text) and carried by
 * the control-plane Worker, which refuses a creation that accepted any other version. The Worker
 * is plain JavaScript with no build step to import a Rust constant, so nothing bound the two: a
 * bump in the crate alone would leave the Worker accepting the old terms.
 *
 * Both sides are read as TEXT; a guard that imported either would pass whatever the other said.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RS_FILE = 'citadel-workspace-types/src/terms.rs';
const JS_FILE = 'deploy/tenant-worker/control/customer-terms.mjs';

function versionFrom(path, pattern) {
  let source;
  try {
    source = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    console.error(`check-customer-terms-version-parity: cannot read ${path}; nothing was compared.`);
    process.exit(1);
  }
  const match = source.match(pattern);
  if (!match) {
    console.error(
      `check-customer-terms-version-parity: no CUSTOMER_TERMS_VERSION declaration in ${path}.\n` +
        'It was renamed or reshaped; the comparison fails rather than report agreement it did not check.',
    );
    process.exit(1);
  }
  return Number(match[1]);
}

const rs = versionFrom(RS_FILE, /pub const CUSTOMER_TERMS_VERSION:\s*u32\s*=\s*(\d+);/);
const js = versionFrom(JS_FILE, /export const CUSTOMER_TERMS_VERSION\s*=\s*(\d+);/);

if (rs !== js) {
  console.error('The Customer Terms version disagrees:\n');
  console.error(`  ${RS_FILE}\n    ${rs}`);
  console.error(`  ${JS_FILE}\n    ${js}\n`);
  console.error('The Worker would accept creations that agreed to terms other than the current ones.');
  process.exit(1);
}
console.log(`The Customer Terms version agrees between the crate and the Worker (${rs}).`);
