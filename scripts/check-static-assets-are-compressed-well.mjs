/**
 * Static assets must be compressed at a level worth the bytes.
 *
 * nginx's `gzip_comp_level` defaults to 1 — its fastest and weakest setting —
 * and the template did not set it. Everything this server returns is a static
 * asset with a content hash in its name, so the CPU spent compressing is not
 * the constraint; the bytes on the wire are.
 *
 * Measured on the shipped bundle: the WASM client is 696 KB at level 1 and
 * 590 KB at level 6. The landing page's critical assets are 377 KB at level 1
 * against the 317 KB the bundle budget reports — the budget measures at zlib's
 * default 6, so it was not measuring what users actually receive.
 *
 * Also asserts that `application/wasm` is in `gzip_types`: it is not in
 * nginx's default set, and the single largest asset this app serves is a
 * `.wasm`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'docker', 'ui', 'nginx.conf.template');

if (!existsSync(TEMPLATE)) {
  console.error(`FAIL: ${TEMPLATE} not found — this gate cannot check anything.`);
  process.exit(1);
}

const conf = readFileSync(TEMPLATE, 'utf8');
const problems = [];

if (!/^\s*gzip\s+on;/m.test(conf)) {
  problems.push('gzip is not enabled');
}

const level = conf.match(/^\s*gzip_comp_level\s+(\d+);/m);
if (!level) {
  problems.push('gzip_comp_level is unset, so nginx uses 1 — its weakest setting');
} else if (Number(level[1]) < 5) {
  problems.push(`gzip_comp_level is ${level[1]}; static assets deserve at least 5`);
}

const types = conf.match(/^\s*gzip_types\s+([^;]+);/m);
if (!types) {
  problems.push('gzip_types is unset');
} else if (!/\bapplication\/wasm\b/.test(types[1])) {
  problems.push(
    'application/wasm is not in gzip_types — it is not in nginx\'s default set, ' +
      'and the WASM client is the single largest asset served',
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`::error file=docker/ui/nginx.conf.template::${p}`);
  console.error(`\nFAIL: ${problems.length} compression setting(s) leave bytes on the table.\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-static-assets-are-compressed-well: gzip on at level ${level[1]}, ` +
    `${types[1].trim().split(/\s+/).length} type(s) including application/wasm.`,
);
