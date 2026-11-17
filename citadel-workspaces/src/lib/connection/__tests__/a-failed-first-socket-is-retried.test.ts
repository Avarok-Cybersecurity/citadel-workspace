/**
 * One failed WebSocket during page start is not the last word.
 *
 * `initialize()` made a single attempt: "Failed to initialize WASM client:
 * WebSocket connection failed (1006)" left the connection manager never
 * initialized for the life of the page -- no stored sessions, no orphan mode,
 * no auto-connect -- and the loader hung on "taking longer than expected".
 *
 * Mocked: the ConnectionIO router, the manager's one I/O boundary. The first
 * socket fails, the second opens; everything the manager decides is real.
 */
import { describe, it, expect, vi } from 'vitest';

const attempts: { count: number } = { count: 0 };
const emitted: string[] = [];
vi.mock('../io', () => {
  const known: Record<string, unknown> = {
    initWebSocket: async (): Promise<void> => {
      attempts.count += 1;
      if (attempts.count === 1) throw new Error('Failed to initialize WASM client: WebSocket connection failed (1006)');
    },
    onEvent: (): (() => void) => (): void => {},
    emitEvent: (event: string): void => { emitted.push(event); },
    canSendRequests: (): boolean => false,
    loadSessionsFromLocalDB: async (): Promise<null> => null,
  };
  // Every other I/O call is a no-op that succeeds: this test is about the socket.
  const connectionIO: unknown = new Proxy(known, {
    get: (target: Record<string, unknown>, key: string): unknown => target[key] ?? ((): Promise<void> => Promise.resolve()),
  });
  return { ConnectionIO: class {}, connectionIO };
});

import { ConnectionManager } from '../service';

describe('starting the connection manager', () => {
  it('retries the agent socket and comes up', async () => {
    const manager: ConnectionManager = ConnectionManager.getInstance();
    await manager.initialize();
    expect(attempts.count).toBe(2);
    await manager.waitForReady();
    expect(manager.initialized).toBe(true);
    // Said at the first failure, so the agent-down banner need not wait out the retries.
    expect(emitted.filter((e: string) => e === 'connection:start-retrying')).toHaveLength(1);
  }, 10_000);
});
