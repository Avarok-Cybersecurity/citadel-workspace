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

// The policy is defined once, in a `map`, and every `add_header` names it as
// `$csp`. It used to be six byte-identical literals, which is what this check
// was reading; when they became one definition this regex found nothing and the
// check said so rather than passing on an empty set -- the right failure, and
// the reason it is written that way.
const served = [...nginx.matchAll(/^\s*default\s+"([^"]+)";/gm)].map((m) => m[1]);
if (served.length === 0) {
  console.error('Found no Content-Security-Policy in the nginx template — this check verified nothing.');
  process.exit(1);
}

// Every location must actually USE the shared definition. Without this, a
// location could carry its own literal policy and the map would still match
// vite while that location served something else entirely.
// Per line, skipping comments: the map's own comment block contains the phrase
// "add_header Content-Security-Policy $csp", and a whole-file regex read that
// prose as a location directive.
const usesMap = nginx
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => !line.startsWith('#'))
  .map((line) => /^add_header Content-Security-Policy ([^;]+);$/.exec(line))
  .filter(Boolean)
  .map((m) => m[1].trim());
const notShared = usesMap.filter((v) => v !== '$csp always');

const problems = [];
if (usesMap.length === 0) {
  console.error('No location sets Content-Security-Policy — this check verified nothing.');
  process.exit(1);
}
for (const v of new Set(notShared)) {
  problems.push(`a location sets Content-Security-Policy to \`${v}\` instead of the shared \`$csp\`.`);
}

const unique = [...new Set(served)];
if (unique.length > 1) {
  problems.push(`nginx defines ${unique.length} different policies; every location must serve the same one.`);
}
for (const raw of unique) {
  // `${LOOPBACK_AGENT_ORIGIN}` is the operator's one off-origin socket -- the
  // agent on the visitor's own machine. It is EMPTY in the compose stack and in
  // preview, which is the deployment this parity is about, so it is removed
  // before comparing and the surrounding whitespace collapsed. Comparing with
  // it present would force vite's PRODUCTION_CSP to name a value that only a
  // hosted deployment sets, and preview would then be more permissive than the
  // stack it is modelling -- the exact inversion this check exists to prevent.
  const policy = raw.replace('${LOOPBACK_AGENT_ORIGIN}', '').replace(/\s+/g, ' ').replace(/\s+;/g, ';').trim();
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

console.log(
  `Preview CSP OK: one policy, matching vite's PRODUCTION_CSP, used by all `
  + `${usesMap.length} location(s) that set it.`,
);
