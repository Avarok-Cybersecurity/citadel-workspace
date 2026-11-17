/**
 * "Is the agent reachable" is a property of the browser, not of the tab.
 *
 * The health probe called `websocketService.isConnected()`, which asks whether
 * THIS tab owns a WASM client. There is one WebSocket per browser: the leader
 * owns the client and every follower proxies through it, with `client = null`
 * by design. So in the app's own documented multi-tab mode, every tab but one
 * reported the local agent unreachable, for ever, while everything worked --
 * a permanent red banner saying "Check that it is running" about an agent that
 * was running.
 *
 * `core.ts` already draws this distinction and its comment describes the exact
 * same bug in `fetchActiveSessions`. The rule existed; this caller never got it.
 */

import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import type { ServiceHealth } from '@/lib/health-check';

const isConnected: ReturnType<typeof vi.fn> = vi.fn();
const canSendRequests: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    isConnected: (): unknown => isConnected(),
    canSendRequests: (): unknown => canSendRequests(),
  },
}));
vi.mock('../websocket-service', () => ({
  websocketService: {
    isConnected: (): unknown => isConnected(),
    canSendRequests: (): unknown => canSendRequests(),
  },
}));

describe('health probe', () => {
  beforeEach(() => {
    isConnected.mockReset();
    canSendRequests.mockReset();
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('reports healthy in a follower tab, which owns no client of its own', async () => {
    const { healthCheckService } = await import('../health-check');
    // Exactly a follower: no client, but able to reach the agent via the leader.
    isConnected.mockReturnValue(false);
    canSendRequests.mockReturnValue(true);

    const health: ServiceHealth = await healthCheckService.checkHealth();

    expect(health.isHealthy).toBe(true);
  });

  it('still reports unhealthy when the tab genuinely cannot reach the agent', async () => {
    const { healthCheckService } = await import('../health-check');
    isConnected.mockReturnValue(false);
    canSendRequests.mockReturnValue(false);

    const health: ServiceHealth = await healthCheckService.checkHealth();

    // The banner exists for this case. A fix that made it never fire would be
    // worse than the bug.
    expect(health.isHealthy).toBe(false);
  });

  it('does not consult the per-tab client question at all', async () => {
    const { healthCheckService } = await import('../health-check');
    canSendRequests.mockReturnValue(true);

    await healthCheckService.checkHealth();

    expect(isConnected).not.toHaveBeenCalled();
  });
});
