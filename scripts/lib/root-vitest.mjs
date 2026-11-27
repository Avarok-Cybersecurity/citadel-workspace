/**
 * Why a vitest run started at the repository root must not go ahead, or null (pure).
 *
 * The root holds no suite of its own. A config-less `npx vitest run` there collected every
 * `*.test.ts` below it, the integration suites among them, and their helpers recreate Docker
 * containers. vitest finds a config by walking up from where it starts, so the root's
 * vitest.config.mjs is read only by runs that have no closer config: from the root itself it
 * refuses, and from anywhere else it is the empty config those runs had before.
 *
 * @param {{ cwd: string, root: string }} at both already resolved to real paths
 */
export function rootVitestRefusal({ cwd, root }) {
  if (cwd !== root) return null;
  return 'vitest at the repository root runs nothing of its own and would collect the integration suites, ' +
    'whose helpers recreate Docker containers. Run a suite where it lives:\n' +
    '  UI unit tests:      cd citadel-workspaces && npx vitest run\n' +
    '  parent gate tests:  node --test scripts/lib/<name>.test.mjs   (what CI runs)\n' +
    '  integration suites: their own runners, see docs/TESTING.md';
}
