#!/usr/bin/env node
/**
 * Every file the UI takes from the brand kit matches the kit.
 *
 * The UI is a separate repository, so it carries copies: public/ icons, the favicon, the social
 * card, the lockup artwork modules and the manifest fields. A copy edited by hand, or a kit
 * updated without re-running scripts/sync-brand-kit.mjs, would ship a logo the guidelines never
 * approved while every UI test stayed green. This re-derives each file and compares bytes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiFiles } from './brand/brand-kit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'assets', 'brand');
const UI = join(ROOT, 'citadel-workspaces');

if (!existsSync(join(UI, 'package.json'))) {
  console.error('check-brand-kit-is-synced: citadel-workspaces is not checked out; refusing to pass on nothing.');
  process.exit(1);
}

const files = uiFiles((p) => readFileSync(join(KIT, p)));
const stale = files.filter(([path, contents]) => {
  const target = join(UI, path);
  return !existsSync(target) || !readFileSync(target).equals(Buffer.from(contents));
});

for (const [path] of stale) console.error(`  citadel-workspaces/${path} differs from the kit`);
if (stale.length > 0) {
  console.error(`check-brand-kit-is-synced: ${stale.length} of ${files.length} files are stale. Run: node scripts/sync-brand-kit.mjs`);
  process.exit(1);
}
console.log(`check-brand-kit-is-synced: ${files.length} files match assets/brand.`);
