/**
 * An edit or a delete must land even when its message is only on disk.
 *
 * `ConversationManager.loadFromStorage` restores every conversation with EMPTY
 * `messages`, and the window holds only the latest 100 anyway. The revision
 * paths looked only in that window, so after the receiver reloaded, an
 * incoming MessageEdit or MessageDelete was dropped as "unknown-message": the
 * old text, or the retracted message, stayed for good. After the SENDER
 * reloaded, editing or deleting their own older message threw instead. Same
 * cause as the reaction-removal defect (a-reaction-removal-survives-a-reload).
 *
 * Replayed with the real ConversationManager, inbound router, messenger
 * revision and page store; only the LocalDB transport is a Map, and it
 * survives `vi.resetModules()` the way disk survives a reload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { P2PMessage } from '../p2p-types';

const disk: Map<string, string> = vi.hoisted(() => new Map<string, string>());
const io: { writable: boolean } = vi.hoisted(() => ({ writable: true }));

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));
vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = disk.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      if (!io.writable) throw new Error('LocalDB timed out');
      disk.set(key, String.fromCharCode(...value));
    },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => { disk.delete(key); },
    sendLocalDBListKeys: async (_cid: bigint, prefix: string): Promise<string[]> => [...disk.keys()].filter((k) => k.startsWith(prefix)),
  },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 4242n }) };
});
// Each `vi.resetModules()` "reload" would open another real BroadcastChannel
// while the earlier one still listens -- two tabs to the channel, whose twin-tab
// repair then calls into the instanceManager stub above. Tabs are not what this
// file measures, so the channel is inert.
vi.mock('@/lib/multi-instance/instance-channel', () => ({
  instanceChannel: new Proxy({}, { get: (): (() => undefined) => (): undefined => undefined }),
}));
vi.mock('../current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 4242n }));
// The real registration service, held across the "reloads" rather than replaced.
// Through presence.ts it brings in the connection, workspace, notification and
// auto-connect layers: about 130 of the ~200 modules a reload re-imports, none of
// which holds a conversation. A reset module is fetched again from the vitest
// main process, one round trip per module, so each reload cost ~45 ms on an idle
// machine and seconds on a loaded runner. Held, only the messaging modules this
// file measures are fresh at each reload. A factory-registered module is not
// invalidated by `vi.resetModules()`; `importOriginal` keeps it production code.
vi.mock('@/lib/p2p-registration-service', async (importOriginal) => importOriginal());

// Fetched and transformed now, at collection, which no test timeout measures.
// The first `reload()` used to pay that cold transform inside the first test.
import '../conversation-manager';
import '../message-handler-routing';
import '../messenger-revision';
import '../message-pagination-store';

const ME: bigint = 4242n;
const PEER: bigint = 777n;

interface Device {
  /** The peer's MessageEdit / MessageDelete arriving through the real router. */
  receive: (layer: Record<string, unknown>) => Promise<void>;
  edit: (id: string, text: string) => Promise<string[]>;
  remove: (id: string) => Promise<string[]>;
  window: () => P2PMessage[];
  /** Put a copy of a stored message in the window, as scrolling or a live arrival would. */
  hold: (m: P2PMessage) => void;
}

/** A page load: fresh modules, conversations restored from disk. */
async function reload(): Promise<Device> {
  vi.resetModules();
  const { ConversationManager } = await import('../conversation-manager');
  const { handleMessagingLayerCommand } = await import('../message-handler-routing');
  const { editMessage, deleteMessage } = await import('../messenger-revision');
  const manager: InstanceType<typeof ConversationManager> = new ConversationManager({
    getCurrentCid: async (): Promise<bigint> => ME, maxMessagesPerConversation: 100, maxQueueSize: 100,
  });
  await manager.loadFromStorage();
  const config: Record<string, unknown> = {
    getCurrentCid: async (): Promise<bigint> => ME,
    isConnected: (): boolean => true,
    getOrCreateConversation: (cid: bigint) => manager.getOrCreateConversation(cid),
    addMessageToConversation: async (): Promise<boolean> => true,
    // The revision paths must not depend on these; poisoned so a regression back to them is loud.
    updateMessageInPages: async (): Promise<boolean> => { throw new Error('revision went through config'); },
    removeMessageFromPages: async (): Promise<boolean> => { throw new Error('revision went through config'); },
    getConversations: () => new Map(),
    notifyMessageListeners: (): void => {}, notifyMessageStatusListeners: (): void => {},
    notifyTypingListeners: (): void => {}, notifyPresenceListeners: (): void => {},
    sendMessageAck: async (): Promise<void> => undefined,
    handleCheckState: async (): Promise<void> => undefined, handleCheckStateResponse: (): void => {},
    markPeerReady: (): void => {}, shouldShowNotification: (): boolean => false, addNotification: (): void => {},
  };
  const recorder = (): { sent: string[]; send: (p: bigint, l: { type: string }) => Promise<void> } => {
    const sent: string[] = [];
    return { sent, send: async (_p: bigint, l: { type: string }): Promise<void> => { sent.push(l.type); } };
  };
  return {
    receive: (layer: Record<string, unknown>): Promise<void> => handleMessagingLayerCommand(
      config as never, { handleFileTransferMessage: async (): Promise<void> => undefined } as never, { layer } as never, PEER,
    ),
    edit: async (id: string, text: string): Promise<string[]> => {
      const r: ReturnType<typeof recorder> = recorder();
      await editMessage(manager, (): void => {}, r.send as never, PEER, id, text);
      return r.sent;
    },
    remove: async (id: string): Promise<string[]> => {
      const r: ReturnType<typeof recorder> = recorder();
      await deleteMessage(manager, (): void => {}, r.send as never, PEER, id);
      return r.sent;
    },
    window: (): P2PMessage[] => manager.getConversation(PEER)?.messages ?? [],
    hold: (m: P2PMessage): void => { manager.getOrCreateConversation(PEER).messages.push({ ...m }); },
  };
}

/** What the NEXT page load renders. */
async function onDisk(): Promise<Array<[string, string, number | undefined]>> {
  vi.resetModules();
  const { messagePaginationStore } = await import('../message-pagination-store');
  return (await messagePaginationStore.loadLatestMessages(PEER)).map((m) => [m.id, m.content, m.edited_at]);
}

const msg = (id: string, senderCid: bigint, content: string, t: number): P2PMessage => ({
  id, content, senderCid, recipientCid: senderCid === ME ? PEER : ME, timestamp: t, index: t, status: 'delivered', message_type: 'text',
});

beforeEach(async () => {
  io.writable = true;
  disk.clear();
  vi.resetModules();
  const { saveMetadata, saveMessagePage } = await import('../message-page-operations');
  // theirs = sent by the peer, received and stored here; mine = sent from here.
  const messages: P2PMessage[] = [msg('theirs', PEER, 'hello', 1), msg('mine', ME, 'hi back', 2)];
  await saveMetadata(PEER, {
    peerCid: PEER, ownerCid: ME, peerUsername: 'peer', totalMessageCount: 2, oldestMessageTimestamp: 1,
    newestMessageTimestamp: 2, latestPage: 0, messagesPerPage: 50, unreadCount: 0, lastMessageIndex: 2, lastUpdated: 2,
  });
  await saveMessagePage(PEER, 0, { peerCid: PEER, pageNumber: 0, messages, pageTimestamps: { minTimestamp: 1, maxTimestamp: 2 } });
});

describe('the receiver, after a reload', () => {
  it('starts from a window that holds none of the conversation', async () => {
    // The premise. If loadFromStorage ever restores messages, this says so.
    expect((await reload()).window()).toEqual([]);
  });

  it("applies the peer's edit to what the next reload shows", async () => {
    await (await reload()).receive({ type: 'MessageEdit', message_id: 'theirs', contents: 'hello (edited)', edited_at: 50 });
    expect(await onDisk()).toEqual([['theirs', 'hello (edited)', 50], ['mine', 'hi back', undefined]]);
  });

  it("applies the peer's delete to what the next reload shows", async () => {
    await (await reload()).receive({ type: 'MessageDelete', message_id: 'theirs', deleted_at: 50 });
    expect((await onDisk()).map(([id]) => id)).toEqual(['mine']);
  });

  it('still refuses an edit or delete of a message the peer did not send', async () => {
    const device: Device = await reload();
    await device.receive({ type: 'MessageEdit', message_id: 'mine', contents: 'forged', edited_at: 50 });
    await device.receive({ type: 'MessageDelete', message_id: 'mine', deleted_at: 51 });
    expect(await onDisk()).toEqual([['theirs', 'hello', undefined], ['mine', 'hi back', undefined]]);
  });
});

describe('the sender, after their own reload', () => {
  it('can edit an older message of theirs, and the edit is stored and sent', async () => {
    expect(await (await reload()).edit('mine', 'hi back (edited)')).toEqual(['MessageEdit']);
    expect((await onDisk())[1].slice(0, 2)).toEqual(['mine', 'hi back (edited)']);
  });

  it('can delete an older message of theirs, and the delete is stored and sent', async () => {
    expect(await (await reload()).remove('mine')).toEqual(['MessageDelete']);
    expect((await onDisk()).map(([id]) => id)).toEqual(['theirs']);
  });

  it('still cannot edit or delete the peer\'s message, and sends nothing', async () => {
    const device: Device = await reload();
    await expect(device.edit('theirs', 'forged')).rejects.toThrow(/not-sender/);
    await expect(device.remove('theirs')).rejects.toThrow(/not-sender/);
    expect(await onDisk()).toEqual([['theirs', 'hello', undefined], ['mine', 'hi back', undefined]]);
  });
});

describe('a message that is in the window as well', () => {
  it('is revised in memory to match the page', async () => {
    const device: Device = await reload();
    device.hold(msg('theirs', PEER, 'hello', 1));
    device.hold(msg('mine', ME, 'hi back', 2));
    await device.receive({ type: 'MessageEdit', message_id: 'theirs', contents: 'hello (edited)', edited_at: 50 });
    await device.receive({ type: 'MessageEdit', message_id: 'mine', contents: 'forged', edited_at: 51 });
    expect(device.window().map((m) => [m.id, m.content])).toEqual([['theirs', 'hello (edited)'], ['mine', 'hi back']]);
    await device.receive({ type: 'MessageDelete', message_id: 'theirs', deleted_at: 52 });
    expect(device.window().map((m) => m.id)).toEqual(['mine']);
  });
});

describe('a revision the store cannot take', () => {
  it('is not sent to the peer, edit or delete', async () => {
    const device: Device = await reload();
    device.hold(msg('mine', ME, 'hi back', 2));
    io.writable = false;
    await expect(device.edit('mine', 'edited')).rejects.toThrow(/Nothing was sent/);
    await expect(device.remove('mine')).rejects.toThrow(/Nothing was sent/);
  });
});
