/**
 * The supervisor says "healing" over the socket and "healed" over the same
 * socket. When the socket dies in between, the second report can never come, and
 * the header read "Reconnecting…" for a link nobody was healing any more.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach((): void => { vi.resetModules(); });

type Handler = (payload: unknown) => void;

function bus(): { on: (e: string, h: Handler) => void; emit: (e: string, p?: unknown) => void; seen: string[] } {
  const handlers: Map<string, Handler[]> = new Map<string, Handler[]>();
  const seen: string[] = [];
  return {
    on: (e: string, h: Handler): void => { handlers.set(e, [...(handlers.get(e) ?? []), h]); },
    emit: (e: string, p?: unknown): void => { seen.push(e); (handlers.get(e) ?? []).forEach((h) => h(p)); },
    seen,
  };
}

const healing: Record<string, unknown> = { SupervisorNotification: { cid: 1n, peer_cid: 2n, state: 'Healing', request_id: null } };

describe('the supervisor status when the socket is lost', () => {
  it('forgets what only that socket could have finished reporting, and tells readers', async (): Promise<void> => {
    const status: typeof import('../status') = await import('../status');
    const b: ReturnType<typeof bus> = bus();
    status.installSupervisorStatus({ bus: b, isLeader: (): boolean => true, wireEvent: 'wire' });
    b.emit('websocket-message', healing);
    expect(status.supervisorStateFor(1n, 2n)).toBe('healing');
    b.seen.length = 0;

    b.emit('websocket-disconnected', { reason: 'closed' });

    expect(status.supervisorStateFor(1n, 2n)).toBeNull();
    expect(b.seen).toContain(status.SUPERVISOR_STATUS_EVENT);
  });

  it('says nothing when there was nothing to forget', async (): Promise<void> => {
    const status: typeof import('../status') = await import('../status');
    const b: ReturnType<typeof bus> = bus();
    status.installSupervisorStatus({ bus: b, isLeader: (): boolean => true, wireEvent: 'wire' });
    b.seen.length = 0;
    b.emit('websocket-disconnected', { reason: 'closed' });
    expect(b.seen).not.toContain(status.SUPERVISOR_STATUS_EVENT);
  });
});
