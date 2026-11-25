import { describe, expect, it } from 'vitest';
import { composeCommand, composeTarget, containerName } from '../compose-guard.js';

describe('the integration helpers run docker compose only when a run opts in', () => {
  it('refuses without CITADEL_INTEGRATION_COMPOSE=1, which is how a root test run reached a developer stack', () => {
    expect(() => composeTarget({ COMPOSE_PROJECT_NAME: 'citadel-workspace' })).toThrow(/CITADEL_INTEGRATION_COMPOSE is not 1/);
    expect(() => composeTarget({ CITADEL_INTEGRATION_COMPOSE: 'true', COMPOSE_PROJECT_NAME: 'citadel-workspace' })).toThrow(/is not 1/);
  });

  it('refuses a project that is not named explicitly, or not a compose project name', () => {
    expect(() => composeTarget({ CITADEL_INTEGRATION_COMPOSE: '1' })).toThrow(/COMPOSE_PROJECT_NAME must name the stack/);
    expect(() => composeTarget({ CITADEL_INTEGRATION_COMPOSE: '1', COMPOSE_PROJECT_NAME: 'x; docker rm -f all' })).toThrow(/must name/);
    expect(() => composeTarget({ CITADEL_INTEGRATION_COMPOSE: '1', COMPOSE_PROJECT_NAME: '' })).toThrow(/must name/);
  });

  it('names the project in every command and container it derives', () => {
    const target = composeTarget({ CITADEL_INTEGRATION_COMPOSE: '1', COMPOSE_PROJECT_NAME: 'citadel-workspace' });
    expect(composeCommand(target, 'pause server')).toBe('docker compose -p citadel-workspace pause server');
    expect(containerName(target, 'internal-service')).toBe('citadel-workspace-internal-service-1');
  });
});
