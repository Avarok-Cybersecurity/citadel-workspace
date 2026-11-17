/**
 * The call re-opens its media when ITS session is claimed on a new connection,
 * and not for anyone else's. The bus is real; the manager is a stand-in whose
 * reopenMedia is tested in lib/call/__tests__/a-call-survives-a-new-leader.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { SESSION_CLAIMED } from '@/lib/multi-instance/claim-relay';
import { useMediaFollowsTheConnection } from '../use-media-follows-the-connection';
import type { CallManager } from '@/lib/call/call-manager';

describe('a session claimed on a new connection', () => {
  it('re-opens the call\'s media when it is this tab\'s session, only then', () => {
    const reopenMedia: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useMediaFollowsTheConnection(11n, { current: { reopenMedia } as unknown as CallManager }));
    eventEmitter.emit(SESSION_CLAIMED, { cid: 99n, relayed: true });
    expect(reopenMedia).not.toHaveBeenCalled();
    eventEmitter.emit(SESSION_CLAIMED, { cid: 11n, relayed: true });
    expect(reopenMedia).toHaveBeenCalledTimes(1);
  });
});
