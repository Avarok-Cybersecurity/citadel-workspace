import { describe, expect, it } from 'vitest';
import { composeCommand, composeTarget, containerName, defaultProjectName } from '../compose-guard.js';

// A checkout whose directory compose would name "citadel-workspace", like the developer's own stack.
const REPO = '/Users/dev/src/Citadel-Workspace';
const OPT_IN = { CITADEL_INTEGRATION_COMPOSE: '1' } as const;

describe('the integration helpers run docker compose only when a run opts in', () => {
  it('refuses without CITADEL_INTEGRATION_COMPOSE=1, which is how a root test run reached a developer stack', () => {
    expect(() => composeTarget({ COMPOSE_PROJECT_NAME: 'citadel-it' }, REPO)).toThrow(/CITADEL_INTEGRATION_COMPOSE is not 1/);
    expect(() => composeTarget({ CITADEL_INTEGRATION_COMPOSE: 'true', COMPOSE_PROJECT_NAME: 'citadel-it' }, REPO)).toThrow(/is not 1/);
  });

  it('refuses an opt-in that names no project, or not a compose project name', () => {
    expect(() => composeTarget({ ...OPT_IN }, REPO)).toThrow(/COMPOSE_PROJECT_NAME must name the stack/);
    expect(() => composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'x; docker rm -f all' }, REPO)).toThrow(/must name/);
    expect(() => composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: '' }, REPO)).toThrow(/must name/);
  });

  it('refuses locally the project compose derives for the checkout, and citadel-workspace, naming another', () => {
    expect(() => composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'citadel-workspace' }, '/w/lane-a')).toThrow(/your own stack's project/);
    expect(() => composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'lane-a' }, '/w/lane-a/')).toThrow(/COMPOSE_PROJECT_NAME=citadel-it/);
    expect(() => composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'citadel-workspace', CI: 'false' }, REPO)).toThrow(/own stack/);
  });

  it('allows locally a project distinct from both', () => {
    expect(composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'citadel-it' }, REPO)).toEqual({ project: 'citadel-it' });
  });

  it('allows citadel-workspace in CI, where the stack is the run\'s own and the workflow expects that name', () => {
    expect(composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'citadel-workspace', CI: 'true' }, REPO)).toEqual({ project: 'citadel-workspace' });
  });

  it('derives the default project as compose does: basename, lower-cased, other characters dropped', () => {
    expect(defaultProjectName(REPO)).toBe('citadel-workspace');
    expect(defaultProjectName('/w/My.Repo_2/')).toBe('myrepo_2');
    expect(defaultProjectName('/w/-_lead')).toBe('lead');
  });

  it('names the project in every command and container it derives', () => {
    const target = composeTarget({ ...OPT_IN, COMPOSE_PROJECT_NAME: 'citadel-workspace', CI: 'true' }, REPO);
    expect(composeCommand(target, 'pause server')).toBe('docker compose -p citadel-workspace pause server');
    expect(containerName(target, 'internal-service')).toBe('citadel-workspace-internal-service-1');
  });
});
