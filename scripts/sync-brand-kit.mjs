#!/usr/bin/env node
/**
 * Writes what the UI takes from the brand kit (assets/brand) into citadel-workspaces/: the icon,
 * favicon and social-card files in public/, the lockup artwork modules and the PWA manifest's
 * kit fields. The kit is the source; these are derived and never hand-edited.
 *
 *   node scripts/sync-brand-kit.mjs            write them
 *   node scripts/check-brand-kit-is-synced.mjs fail if any differs (CI)
 *
 * The derivation is scripts/brand/brand-kit.mjs; this file is only its reads and writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiFiles } from './brand/brand-kit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'assets', 'brand');
const UI = join(ROOT, 'citadel-workspaces');

for (const [path, contents] of uiFiles((p) => readFileSync(join(KIT, p)))) {
  const target = join(UI, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  console.log(`wrote citadel-workspaces/${path}`);
}
