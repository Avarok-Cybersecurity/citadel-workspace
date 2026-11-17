/**
 * An unsolicited disconnect answer carries `request_id: None`, which the WASM
 * client delivers as an absent field. Matching on `=== null` ignored it, so the
 * caller waited out the whole disconnect budget for an answer it already had.
 */
import { describe, it, expect, vi } from 'vitest';
import { DisconnectOperations } from '../disconnect-operations';
import { eventEmitter } from '@/lib/event-emitter';

const CID: bigint = 4242n;

function started(): { pending: Promise<void>; sent: () => boolean } {
  let sent: boolean = false;
  const ops: DisconnectOperations = new DisconnectOperations({
    init: async (): Promise<void> => {},
    sendRequest: async (): Promise<void> => { sent = true; },
  });
  return { pending: ops.disconnect(CID), sent: (): boolean => sent };
}

describe('a disconnect answer whose request_id is absent', () => {
  it('resolves the disconnect for that session', async (): Promise<void> => {
    const { pending, sent } = started();
    await vi.waitFor((): void => { expect(sent()).toBe(true); });
    eventEmitter.emit('websocket-message', { DisconnectNotification: { cid: CID } });
    await expect(pending).resolves.not.toThrow();
  });

  it('rejects the disconnect for that session when it is a failure', async (): Promise<void> => {
    const { pending, sent } = started();
    await vi.waitFor((): void => { expect(sent()).toBe(true); });
    eventEmitter.emit('websocket-message', { PeerDisconnectFailure: { cid: CID, message: 'gone' } });
    await expect(pending).rejects.toThrow('gone');
  });
});
