/**
 * Two edges of a session ending: a window that is offered its session back
 * and declines leaves (the caller's `declined`), and a window's OWN sign-out
 * is never taken for one in another window.
 */
import { describe, it, expect, vi } from 'vitest';
import { offerTakeover } from '../takeover';
import { endedElsewhere, type SessionEnded } from '../session-ended';
import { DisconnectOperations } from '@/lib/websocket/disconnect-operations';
import { eventEmitter } from '@/lib/event-emitter';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

describe('offering a session back', () => {
  it('signs in on yes, and calls declined on no', async () => {
    await greetAs(true);
    const signInAs = vi.fn<(u: string) => void>();
    const declined = vi.fn<() => void>();
    await offerTakeover('alice', { confirm: async (): Promise<boolean> => true, signInAs, declined });
    expect(signInAs).toHaveBeenCalledWith('alice');
    expect(declined).not.toHaveBeenCalled();
    await offerTakeover('alice', { confirm: async (): Promise<boolean> => false, signInAs, declined });
    expect(declined).toHaveBeenCalledTimes(1);
  });
});

describe('this window signing out', () => {
  it('hears its own answer as its own, not as another window\'s', async () => {
    const heard: Array<SessionEnded | null> = [];
    const off: () => void = eventEmitter.on('websocket-message', (m: unknown) => { heard.push(endedElsewhere(m)); });
    const ops: DisconnectOperations = new DisconnectOperations({
      init: async (): Promise<void> => {},
      sendRequest: async (request: unknown): Promise<void> => {
        const id: string = (request as { Disconnect: { request_id: string } }).Disconnect.request_id;
        queueMicrotask(() => eventEmitter.emit('websocket-message', { DisconnectNotification: { cid: 7n, peer_cid: null, request_id: id } }));
      },
    });
    await ops.disconnect(7n);
    off();
    expect(heard).toEqual([null]);
  });
});
