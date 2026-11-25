/**
 * Whether the integration helpers may run `docker compose`, and against which project (pure).
 *
 * The helpers recreate, pause and restart containers. A test runner started from the repository
 * root collects these suites as ordinary tests, and then recreated whatever stack compose derived
 * from the directory: a developer's own. So compose runs only when the run says so explicitly,
 * CITADEL_INTEGRATION_COMPOSE=1, and only against the project COMPOSE_PROJECT_NAME names, never one
 * derived from a directory. CI sets both on the integration jobs (validate.yml).
 */

export interface ComposeTarget {
  readonly project: string;
}

/** Compose's own rule for a project name; also keeps the name safe inside a shell command. */
const PROJECT_NAME: RegExp = /^[a-z0-9][a-z0-9_-]*$/;

export function composeTarget(env: Readonly<Record<string, string | undefined>>): ComposeTarget {
  if (env.CITADEL_INTEGRATION_COMPOSE !== '1') {
    throw new Error(
      'refusing to run docker compose: CITADEL_INTEGRATION_COMPOSE is not 1. These helpers recreate containers, ' +
        'so they run only when a run opts in (CI does, on its integration jobs). To run a suite against your own ' +
        'stack on purpose: CITADEL_INTEGRATION_COMPOSE=1 COMPOSE_PROJECT_NAME=<your stack\'s project> npm run <suite>',
    );
  }
  const project: string | undefined = env.COMPOSE_PROJECT_NAME;
  if (project === undefined || !PROJECT_NAME.test(project)) {
    throw new Error(
      `refusing to run docker compose: COMPOSE_PROJECT_NAME must name the stack explicitly (got ${JSON.stringify(project ?? null)}); ` +
        'a project derived from the directory is how a stray run reached a developer\'s stack',
    );
  }
  return { project };
}

/** `docker compose -p <project> <args>`, as one shell command. */
export function composeCommand(target: ComposeTarget, args: string): string {
  return `docker compose -p ${target.project} ${args}`;
}

/** The container compose names for a service's first replica. */
export function containerName(target: ComposeTarget, service: string): string {
  return `${target.project}-${service}-1`;
}
