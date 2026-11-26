/**
 * What a check that builds against the UI needs in the clone before it can say anything (pure).
 *
 * A browser gate, tsc, vitest or eslint over the UI resolves both TypeScript clients from their
 * dist/ and the agent client's WASM glue. Missing, they fail as an unrelated-looking import or mount
 * error deep inside a gate (check:app-zone, check:app-page) after minutes of other checks. So the hook
 * names them before running anything, with the one command that sets a clone up.
 */
export const UI_PREREQUISITES = [
  { path: 'citadel-internal-service/typescript-client/citadel_internal_service_wasm_client.js', what: 'the WASM glue the agent client imports' },
  { path: 'citadel-internal-service/typescript-client/dist/index.js', what: 'the agent TypeScript client, built' },
  { path: 'citadel-workspace-client-ts/dist/index.js', what: 'the workspace TypeScript client, built' },
];

export const BOOTSTRAP = 'scripts/bootstrap.sh';

/**
 * @param {{ checks: {cmd: string, cwd: string, relevance?: {browser: boolean}}[], uiDirs: string[], exists: (path: string) => boolean }} input
 * @returns {string|null} the refusal, or null when nothing that will run needs them or they are all there
 */
export function prerequisiteProblem({ checks, uiDirs, exists }) {
  const needing = checks.filter((c) => c.relevance?.browser === true || (c.cmd !== 'node' && uiDirs.includes(c.cwd)));
  const missing = UI_PREREQUISITES.filter((p) => !exists(p.path));
  if (needing.length === 0 || missing.length === 0) return null;
  return [`${needing.length} check(s) about to run build against the UI's TypeScript clients, which this clone lacks:`,
    ...missing.map((p) => `  - ${p.path} (${p.what})`),
    `  set the clone up (Node 20 first on PATH): ${BOOTSTRAP}`].join('\n');
}
