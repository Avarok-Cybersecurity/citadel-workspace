// The variables an operator must set for a production deployment, and why.
//
// Two places refuse to run without a value, and both count:
//   - docker-compose.production.yml: `${VAR}` with no `:-`/`-` default anywhere;
//   - deploy.sh: an `ERROR: VAR is unset or empty` refusal. LOOPBACK_AGENT_ORIGIN
//     is required only here -- compose defaults it to empty, which is right for
//     a local deployment -- and a gate that read compose alone let it go
//     undocumented while deploy.sh aborted on it.
//
// Derived, never listed, so a new requirement is a failure until documented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const COMPOSE = 'docker-compose.production.yml';
export const DEPLOY = 'deploy.sh';

/** @returns {Map<string, string>} variable name -> where it is required */
export function requiredEnv(root) {
  const compose = readFileSync(join(root, COMPOSE), 'utf8');
  const fromCompose = new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]));
  for (const [, name] of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)[:-]/g)) fromCompose.delete(name);
  if (fromCompose.size === 0) throw new Error(`no required \${VAR} found in ${COMPOSE} -- the pattern must have changed`);

  const deploy = readFileSync(join(root, DEPLOY), 'utf8');
  const fromDeploy = new Set([...deploy.matchAll(/ERROR: ([A-Z_][A-Z0-9_]*) is unset or empty/g)].map((m) => m[1]));
  if (fromDeploy.size === 0) throw new Error(`no "ERROR: VAR is unset or empty" refusal found in ${DEPLOY} -- the pattern must have changed`);

  const required = new Map();
  for (const name of fromCompose) required.set(name, COMPOSE);
  for (const name of fromDeploy) required.set(name, required.has(name) ? `${COMPOSE} and ${DEPLOY}` : DEPLOY);
  return required;
}
