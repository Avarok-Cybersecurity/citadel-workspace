#!/usr/bin/env node
/**
 * Every nginx location that serves content must carry the same headers as `/`.
 *
 * nginx's `add_header` does not inherit into a block that adds any header of its
 * own. The config says so itself:
 *
 *   > every location that adds a header must repeat all of them. Verbose, but
 *   > the alternative is a location that quietly ships with no CSP.
 *
 * That is a rule enforced by hand across five blocks, protecting a property
 * whose loss is silent: a location missing `Content-Security-Policy` serves the
 * same bytes, with the same status, and nothing fails. The comment names the
 * hazard and then relies on the reader to remember it — which is the shape this
 * campaign has found broken over and over.
 *
 * The required set is DERIVED from `location /`, not written out here. Adding a
 * header to the root makes every sibling required to carry it, and there is no
 * second list to update — the failure mode of a hardcoded list is that it drifts
 * from the thing it describes and starts passing over the wrong set.
 *
 * `proxy_pass` blocks are exempt, and the exemption is verified rather than
 * named: a WebSocket upgrade is not a document, carries no CSP-relevant
 * content, and is identified by what it does rather than by being on a list.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'docker', 'ui', 'nginx.conf.template');

if (!existsSync(TEMPLATE)) {
  console.error('check-nginx-headers-are-complete: nginx.conf.template is missing, so nothing was checked.');
  process.exit(1);
}

const conf = readFileSync(TEMPLATE, 'utf8');

/** Each `location <match> { … }` with its body, brace-matched. */
function locations() {
  const out = [];
  for (const match of conf.matchAll(/^\s*location\s+([^{]+)\{/gm)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < conf.length && depth > 0) {
      if (conf[i] === '{') depth += 1;
      else if (conf[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ name: match[1].trim(), body: conf.slice(start, i) });
  }
  return out;
}

const blocks = locations();
if (blocks.length < 3) {
  console.error(
    `check-nginx-headers-are-complete: only ${blocks.length} location blocks found — ` +
      'the template moved or changed shape, so this check cannot be trusted.',
  );
  process.exit(1);
}

const headersIn = (body) => new Set([...body.matchAll(/add_header\s+([A-Za-z-]+)/g)].map((m) => m[1]));

const root = blocks.find((b) => b.name === '/');
if (!root) {
  console.error('check-nginx-headers-are-complete: no `location /` to derive the required headers from.');
  process.exit(1);
}

const required = [...headersIn(root.body)].filter((h) => h !== 'Cache-Control');
if (required.length < 3) {
  console.error(
    `check-nginx-headers-are-complete: \`location /\` carries only ${required.length} headers — ` +
      'deriving the requirement from it would check almost nothing.',
  );
  process.exit(1);
}

const failures = [];
const rows = [];
for (const { name, body } of blocks) {
  // A proxied upgrade is not a document. Identified by what the block does.
  if (/proxy_pass/.test(body)) {
    rows.push(`  ${name.padEnd(26)} proxied — exempt`);
    continue;
  }
  const have = headersIn(body);
  const missing = required.filter((h) => !have.has(h));
  rows.push(`  ${name.padEnd(26)} ${missing.length === 0 ? 'ok' : `MISSING ${missing.join(', ')}`}`);
  if (missing.length > 0) failures.push(`location ${name} is missing: ${missing.join(', ')}`);
}

console.log(`\n  Required, from \`location /\`: ${required.join(', ')}\n`);
console.log(rows.join('\n'));

if (failures.length > 0) {
  console.error('\ncheck-nginx-headers-are-complete: locations serving content without the full header set:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`\ncheck-nginx-headers-are-complete: OK — ${blocks.length} locations, all consistent with \`/\`.`);
