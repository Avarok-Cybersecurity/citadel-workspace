/**
 * A tab stops holding a session once the agent says the session ended.
 *
 * Live (0.15.4): "[FollowerSessionClaims] claiming <cid> for another tab failed Error: Session
 * <cid> not found", with nothing wrong on screen. Signing out cleared the tab's selection but
 * not the session it announces to the other tabs (instanceManager), so the tab, now on the
 * landing page, kept answering every report with the ended session's CID, and every new
 * leader connection claimed a session the agent had removed.
 *
 * Real: the wiring the app loads (websocket-service/index.ts), the event bus and the instance
 * manager; what the other tabs are told is `instance:cid-changed`, which the instance channel
 * sends as a cid-update. Stood in: IndexedDB, which jsdom lacks (storage-utils over a Map).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const deviceStore: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  ...(await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(deviceStore),
}));

import '@/lib/websocket-service';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { instanceChannel } from '@/lib/multi-instance/instance-channel';
import { clearSelectedUser, getSelectedUser, setSelectedUser, type TabUserContext } from '@/lib/tab-context';

const ended = (cid: bigint, peer: bigint | null): Record<string, unknown> =>
  ({ DisconnectNotification: { cid, peer_cid: peer, request_id: null } });

describe('a session that ended', () => {
  const announced: Array<bigint | null> = [];
  const offs: Array<() => void> = [];

  beforeEach(() => {
    announced.length = 0;
    instanceManager.setCid(null);
    offs.push(eventEmitter.on('instance:cid-changed', (data: { cid: bigint | null }) => { announced.push(data.cid); }));
  });

  afterEach(() => {
    for (const off of offs.splice(0)) off();
    instanceManager.setCid(null);
  });

  it('signed out (here or in another window) is no longer this tab\'s, and the other tabs are told', () => {
    instanceManager.setCid(7n);
    eventEmitter.emit('websocket-message', ended(7n, null));
    expect(instanceManager.cid).toBeNull();
    expect(announced).toEqual([7n, null]);
  });

  it('deleted is no longer this tab\'s', () => {
    instanceManager.setCid(7n);
    eventEmitter.emit('websocket-message', { Response: { DeregisterSuccess: { cid: 7n, request_id: null } } });
    expect(instanceManager.cid).toBeNull();
  });

  it('is another account\'s, or a peer leaving, and this tab keeps its own', () => {
    instanceManager.setCid(7n);
    eventEmitter.emit('websocket-message', ended(8n, null));
    eventEmitter.emit('websocket-message', ended(7n, 9n));
    expect(instanceManager.cid).toBe(7n);
    expect(announced).toEqual([7n]);
  });
});

describe('a tab that kept the page for unsaved text', () => {
  // Its selection still names the ended session, and a tab holding nothing answers a report
  // from its selection (instance-channel.ts broadcastCid): that put the CID straight back.
  const alice: TabUserContext = { selectedUsername: 'alice', selectedServerAddress: 'server:1', selectedCid: 7n };
  /** The answer's own steps (import, then the selection read), queued after it, then a turn. */
  const answered = async (): Promise<void> => {
    await import('@/lib/tab-context');
    await getSelectedUser();
    await new Promise<void>((done: () => void): void => { setTimeout(done, 0); });
  };

  afterEach(async () => {
    await clearSelectedUser();
    instanceManager.setCid(null);
  });

  it('does not announce the ended session again when asked to report', async () => {
    await setSelectedUser(alice);
    instanceManager.setCid(7n);
    eventEmitter.emit('websocket-message', ended(7n, null));
    instanceChannel.broadcastCid();
    await answered();
    expect(instanceManager.cid).toBeNull();
  });

  it('announces it again once it holds it again: signing in gives the same CID', async () => {
    await setSelectedUser(alice);
    instanceManager.setCid(7n);
    eventEmitter.emit('websocket-message', ended(7n, null));
    instanceManager.setCid(7n);
    instanceManager.setCid(null);
    instanceChannel.broadcastCid();
    await answered();
    expect(instanceManager.cid).toBe(7n);
  });
});
