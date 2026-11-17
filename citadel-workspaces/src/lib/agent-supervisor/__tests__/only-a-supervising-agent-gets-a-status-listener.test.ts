/**
 * The supervisor status listener (and its module) load when the agent says it
 * supervises, not before: an older agent never reports, and the landing path
 * does not pay for it. Fresh modules per test, since the listener installs once.
 *
 * Real: the service singleton, the capability read from the greeting, the
 * status module. Stood in: nothing beyond FakeAgent's recorded sender.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach((): void => { vi.resetModules(); });

interface World {
  agent: import('./fake-supervising-agent').FakeAgent;
  stateFor: (cid: bigint, peer: bigint) => string | null;
}

async function world(): Promise<World> {
  await import('@/lib/p2p-auto-connect-service');
  const { FakeAgent } = await import('./fake-supervising-agent');
  const { supervisorStateFor } = await import('../status');
  return { agent: new FakeAgent(), stateFor: supervisorStateFor };
}

const healing: Record<string, unknown> = { SupervisorNotification: { cid: 1n, peer_cid: 2n, state: 'Healing', request_id: null } };

describe('the status listener', () => {
  it('is installed once the agent says it supervises', async (): Promise<void> => {
    const { agent, stateFor }: World = await world();
    await agent.greet('supervising');
    await vi.dynamicImportSettled();
    agent.wire(healing);
    expect(stateFor(1n, 2n)).toBe('healing');
  });

  it('is not installed for an agent that does not', async (): Promise<void> => {
    const { agent, stateFor }: World = await world();
    await agent.greet('older');
    await vi.dynamicImportSettled();
    agent.wire(healing);
    expect(stateFor(1n, 2n)).toBeNull();
  });

  it('is installed once, however many sockets say so', async (): Promise<void> => {
    const { agent }: World = await world();
    const { eventEmitter } = await import('@/lib/event-emitter');
    const before: number = eventEmitter.listenerCount('websocket-message');
    await agent.greet('supervising');
    await vi.dynamicImportSettled();
    const once: number = eventEmitter.listenerCount('websocket-message');
    await agent.greet('supervising');
    await vi.dynamicImportSettled();
    expect(once).toBe(before + 1);
    expect(eventEmitter.listenerCount('websocket-message')).toBe(once);
  });
});
