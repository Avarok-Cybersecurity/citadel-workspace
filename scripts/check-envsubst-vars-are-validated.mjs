#!/usr/bin/env node
/**
 * Every variable envsubst is allowed to substitute must be validated first.
 *
 * `NGINX_ENVSUBST_FILTER` in docker/ui/Dockerfile pins which environment
 * variables reach the nginx config. `docker/ui/16-validate-runtime-vars.sh`
 * runs before envsubst and rejects values that would break out of the
 * directive they land in -- a `;` in AGENT_UPSTREAM closes proxy_pass and the
 * rest becomes real configuration; a quote in a `sub_filter` argument does the
 * same, next door to the Content-Security-Policy headers.
 *
 * The two lists are maintained by hand, in different files, in different
 * languages. They have drifted: the filter grew to four variables and then to
 * five, and the validator followed once. DEFAULT_WORKSPACE_SERVER was
 * substituted into the config for a whole release without ever being checked,
 * and both files' own header comments still said "three" and "four".
 *
 * That is this repository's most productive defect shape -- a set grew and one
 * member was missed -- so it gets a mechanical check rather than a promise.
 *
 * What this does NOT assert: that each validation is CORRECT. It asserts only
 * that somebody wrote one. A rule that accepts everything would pass here and
 * fail its own consumer, which is what the per-variable comments in the
 * validator are for.
 */
import { readFileSync } from 'node:fs';

const DOCKERFILE = 'docker/ui/Dockerfile';
const VALIDATOR = 'docker/ui/16-validate-runtime-vars.sh';

const dockerfile = readFileSync(DOCKERFILE, 'utf8');
const filterLine = dockerfile.match(/^ENV NGINX_ENVSUBST_FILTER=\^\(([^)]+)\)\$$/m);
if (!filterLine) {
  console.error(
    `\n  Could not find NGINX_ENVSUBST_FILTER in ${DOCKERFILE}.\n\n` +
    `  It is expected as: ENV NGINX_ENVSUBST_FILTER=^(A|B|C)$\n` +
    `  If the shape changed, fix this reader -- do NOT delete the check. An\n` +
    `  unparsed filter means every variable is unvalidated and nothing says so.\n`,
  );
  process.exit(1);
}

const filtered = filterLine[1].split('|').map((v) => v.trim()).filter(Boolean);

// A variable is "validated" if the script reads it. `${VAR:-}` is the form the
// validator uses; accept a bare mention too, so a differently-written check
// still counts and this gate does not dictate style.
const validator = readFileSync(VALIDATOR, 'utf8');
const unvalidated = filtered.filter((v) => !new RegExp(`\\b${v}\\b`).test(validator));

if (unvalidated.length > 0) {
  console.error(
    `\n  These variables reach the nginx config but nothing validates them:\n\n` +
    unvalidated.map((v) => `    ${v}`).join('\n') +
    `\n\n  ${DOCKERFILE} admits them through NGINX_ENVSUBST_FILTER, and\n` +
    `  ${VALIDATOR} never reads them. envsubst substitutes verbatim, so a\n` +
    `  value containing a quote or a semicolon becomes nginx configuration --\n` +
    `  beside the Content-Security-Policy headers.\n\n` +
    `  Add a check to the validator, or remove the variable from the filter.\n`,
  );
  process.exit(1);
}

// The converse: a validated variable NOT in the filter is dead code, and worse,
// it reads as protection that is not in force.
const filteredSet = new Set(filtered);
const KNOWN_NON_ENVSUBST = new Set([]);
const declaredChecks = [...validator.matchAll(/^(\w+)="\$\{([A-Z_]+):-\}"/gm)].map((m) => m[2]);
const orphaned = declaredChecks.filter((v) => !filteredSet.has(v) && !KNOWN_NON_ENVSUBST.has(v));

if (orphaned.length > 0) {
  console.error(
    `\n  These are validated but never substituted:\n\n` +
    orphaned.map((v) => `    ${v}`).join('\n') +
    `\n\n  Either they were dropped from NGINX_ENVSUBST_FILTER and the check was\n` +
    `  left behind -- reading as protection that no longer applies -- or the\n` +
    `  filter is missing one. Both are worth knowing.\n`,
  );
  process.exit(1);
}

console.log(`envsubst variables validated: ${filtered.join(', ')}`);
