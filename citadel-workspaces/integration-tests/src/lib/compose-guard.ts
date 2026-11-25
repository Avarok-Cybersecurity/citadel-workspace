/**
 * Whether the integration helpers may run `docker compose`, and against which project (pure).
 *
 * The helpers recreate, pause and restart containers. A test runner started from the repository
 * root collects these suites as ordinary tests, and then recreated whatever stack compose derived
 * from the directory: a developer's own. So compose runs only when the run says so explicitly,
 * CITADEL_INTEGRATION_COMPOSE=1, and only against the project COMPOSE_PROJECT_NAME names, never one
 * derived from a directory. CI sets both on the integration jobs (validate.yml).
 *
 * Outside CI the name must also differ from the developer's own stack: the one compose derives from
 * the directory holding docker-compose.yml, and the literal `citadel-workspace`. In CI (`CI` set) the
 * stack is the run's own, and its name stays what the workflow's image and container names expect.
 */

export interface ComposeTarget {
  readonly project: string;
}

/** Compose's own rule for a project name; also keeps the name safe inside a shell command. */
const PROJECT_NAME: RegExp = /^[a-z0-9][a-z0-9_-]*$/;

/** The project compose names a directory's stack when none is given: its basename, normalised as compose does. */
export function defaultProjectName(composeDir: string): string {
  const base: string = composeDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z0-9]+/, '');
}

/** @param composeDir the directory holding the docker-compose.yml these helpers drive */
export function composeTarget(env: Readonly<Record<string, string | undefined>>, composeDir: string): ComposeTarget {
  if (env.CITADEL_INTEGRATION_COMPOSE !== '1') {
    throw new Error(
      'refusing to run docker compose: CITADEL_INTEGRATION_COMPOSE is not 1. These helpers recreate containers, ' +
        'so they run only when a run opts in (CI does, on its integration jobs). To run a suite locally, against a ' +
        'stack of its own: CITADEL_INTEGRATION_COMPOSE=1 COMPOSE_PROJECT_NAME=citadel-it npm run <suite>',
    );
  }
  const project: string | undefined = env.COMPOSE_PROJECT_NAME;
  if (project === undefined || !PROJECT_NAME.test(project)) {
    throw new Error(
      `refusing to run docker compose: COMPOSE_PROJECT_NAME must name the stack explicitly (got ${JSON.stringify(project ?? null)}); ` +
        'a project derived from the directory is how a stray run reached a developer\'s stack',
    );
  }
  const inCi: boolean = env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
  const own: string[] = [defaultProjectName(composeDir), 'citadel-workspace'];
  if (!inCi && own.includes(project)) {
    throw new Error(
      `refusing to run docker compose: COMPOSE_PROJECT_NAME=${project} is your own stack's project (compose derives ` +
        `${JSON.stringify(own[0])} from ${composeDir}). These helpers recreate its containers; a local run names a ` +
        'different project, e.g. COMPOSE_PROJECT_NAME=citadel-it',
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
