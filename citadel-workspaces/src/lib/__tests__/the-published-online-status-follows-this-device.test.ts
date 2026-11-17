/**
 * The Online Status choice other members' clients read is the one this device
 * obeys. The setting is per device and the record per account, so a sign-in
 * whose record says otherwise (published elsewhere, or never) is corrected.
 *
 * The publisher is injected: it is the send to the workspace server.
 */
import { describe, it, expect, vi } from 'vitest';
import { reconcileOnlineStatusWith, type OnlineStatusPublisher } from '../online-status-publication';

vi.mock('@/lib/workspace-service', () => ({ default: {} }));

function publisher(local: boolean, result: Promise<void> = Promise.resolve()): OnlineStatusPublisher & { sent: boolean[] } {
  const sent: boolean[] = [];
  return { sent, localChoice: (): boolean => local, publish: async (shows: boolean): Promise<void> => { sent.push(shows); return result; } };
}

const settle = (): Promise<void> => new Promise((resolve: () => void): void => { setTimeout(resolve, 0); });

describe('reconciling the published Online Status', () => {
  it('publishes the local choice when the record says otherwise', async () => {
    const off: ReturnType<typeof publisher> = publisher(false);
    reconcileOnlineStatusWith(off, true);
    await settle();
    expect(off.sent).toEqual([false]);
  });

  it('publishes "off" over a record that never chose, which reads as shown', async () => {
    const off: ReturnType<typeof publisher> = publisher(false);
    reconcileOnlineStatusWith(off, undefined);
    await settle();
    expect(off.sent).toEqual([false]);
  });

  it('sends nothing when the record already agrees', async () => {
    const on: ReturnType<typeof publisher> = publisher(true);
    reconcileOnlineStatusWith(on, true);
    reconcileOnlineStatusWith(on, undefined);
    const off: ReturnType<typeof publisher> = publisher(false);
    reconcileOnlineStatusWith(off, false);
    await settle();
    expect([...on.sent, ...off.sent]).toEqual([]);
  });

  it('sends once while a publish is in flight, and tries again after a failure', async () => {
    const failing: ReturnType<typeof publisher> = publisher(false, Promise.reject(new Error('socket closed')));
    reconcileOnlineStatusWith(failing, true);
    reconcileOnlineStatusWith(failing, true);
    await settle();
    expect(failing.sent).toEqual([false]);
    reconcileOnlineStatusWith(failing, true);
    await settle();
    expect(failing.sent).toEqual([false, false]);
  });
});
