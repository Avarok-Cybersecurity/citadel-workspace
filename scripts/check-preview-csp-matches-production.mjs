#!/usr/bin/env node
/**
 * The CSP `npm run preview` serves must be the one nginx serves.
 *
 * `npm run preview` is the only command that serves the real production bundle,
 * so it is the only local place a CSP violation can surface before deploy. That
 * only holds while the two policies are identical. vite.config.ts says so in
 * as many words — "PRODUCTION_CSP is byte-identical to the policy nginx sends
 * in docker/ui/nginx.conf.template. That is the whole point."
 *
 * It has not always been true. The same comment records the drift: preview once
 * allowed `'unsafe-inline'` in script-src plus two CDN origins that nginx did
 * not, "which made preview STRICTLY MORE PERMISSIVE than production and unable
 * to catch the very class of bug it exists to catch".
 *
 * A preview that is more permissive than production does not fail. It passes,
 * and the violation appears after deploy. So the property is enforced here
 * rather than restated.
 *
 * check-nginx-headers-are-complete covers a neighbouring rule — that every
 * nginx location repeats the headers, since add_header does not inherit. It
 * compares nginx to itself and never opens vite.config.ts.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VITE = join(ROOT, 'citadel-workspaces', 'vite.config.ts');
const NGINX = join(ROOT, 'docker', 'ui', 'nginx.conf.template');

const vite = readFileSync(VITE, 'utf8');
const nginx = readFileSync(NGINX, 'utf8');

const declared = /const PRODUCTION_CSP\s*=\s*\n?\s*"([^"]+)"/.exec(vite);
if (!declared) {
  console.error('Could not find PRODUCTION_CSP in vite.config.ts — this check verified nothing.');
  process.exit(1);
}

const served = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
if (served.length === 0) {
  console.error('Found no Content-Security-Policy in the nginx template — this check verified nothing.');
  process.exit(1);
}

const problems = [];
const unique = [...new Set(served)];
if (unique.length > 1) {
  problems.push(`nginx serves ${unique.length} different policies; every location must serve the same one.`);
}
for (const policy of unique) {
  if (policy !== declared[1]) {
    problems.push(
      'PRODUCTION_CSP does not match the policy nginx serves.\n' +
        `      preview: ${declared[1]}\n` +
        `      nginx:   ${policy}`,
    );
  }
}

if (problems.length > 0) {
  console.error('The preview CSP and the production CSP have drifted:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nA preview more permissive than production passes while the violation ships.\n' +
      'Make them identical, in vite.config.ts and docker/ui/nginx.conf.template.',
  );
  process.exit(1);
}

console.log(`Preview CSP OK: identical to the policy nginx serves in ${served.length} location(s).`);
