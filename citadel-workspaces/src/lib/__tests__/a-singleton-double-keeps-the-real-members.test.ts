/**
 * A singleton double must still answer every member production code calls from a
 * timer or a promise chain: a bare `{ getConnectionInfo }` stub made them throw
 * "x is not a function" long after the assertion that installed it.
 */
import { describe, it, expect } from 'vitest';
import { doubleOf } from '@/test/singleton-double';
import { connectionManager } from '@/lib/connection';
import { eventEmitter } from '@/lib/event-emitter';

describe('a singleton double', () => {
  it('replaces only what it names', () => {
    const emitted: string[] = [];
    const double: typeof eventEmitter = doubleOf(eventEmitter, { emit: ((event: string): void => { emitted.push(event); }) as never });
    double.emit('x');
    expect(emitted).toEqual(['x']);
    expect(typeof double.on).toBe('function');
    expect(typeof double.off).toBe('function');
  });

  it('keeps every real member of the connection manager callable', () => {
    const double: typeof connectionManager = doubleOf(connectionManager, { getConnectionInfo: (() => null) as never });
    for (const name of ['getTabSelectedSession', 'getStoredSessions', 'invalidateSessionCache', 'getActiveSessions'] as const) {
      expect(typeof double[name]).toBe('function');
    }
    expect(double.getConnectionInfo()).toBeNull();
  });

  it('does not touch the real singleton', () => {
    doubleOf(eventEmitter, { emit: (() => undefined) as never });
    expect(Object.getOwnPropertyDescriptor(eventEmitter, 'emit')).toBeUndefined();
  });
});
