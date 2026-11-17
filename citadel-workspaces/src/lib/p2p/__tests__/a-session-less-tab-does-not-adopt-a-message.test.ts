/**
 * A tab logged into nobody processed another account's messages.
 *
 * One browser holds one WebSocket, and the leader tab that holds it is very
 * often the landing/connect page — a tab with no session and no cid. The
 * MessageNotification guard computed `effectiveCid = currentCid ??
 * notificationCid`, so on exactly that tab the "is this for a different
 * session?" check compared the notification's cid against itself: vacuously
 * false, and a fallback-delivered notification for ANY account was written to
 * the conversation store and emitted as `p2p:message-received` in a tab that
 * was nobody. The path even logged "WARNING: currentCid is null, using
 * notification CID as fallback" — known, and still wrong.
 *
 * The fix is the shared `isForThisSession` (a fourth hand-rolled copy of this
 * check is how the family of bugs it documents came to exist): unless both
 * cids are known and equal, the leader broadcasts the notification to the
 * follower tabs, where `handleP2PNotification` filters by cid and only the
 * owner processes it. Refusing is not dropping — the hand-off is the point,
 * and these tests assert both halves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { P2PCommand } from '@/types/p2p-commands';
import type { MessageHandlerConfig } from '@/lib/p2p/message-handler-types';
import type { InternalServiceResponse } from 'citadel-workspace-client-ts';

const PEER: bigint = 42n;
const OWNER: bigint = 555n;
const OTHER: bigint = 111n;

let currentCid: bigint | null = null;
const dispatched: Uint8Array[] = [];
const broadcasts: unknown[] = [];

vi.mock('@/lib/debug-config', () => ({ debugEnabled: false, debugLog: (): void => {} }));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { isPeerRegistered: (): boolean => true },
}));
vi.mock('@/lib/broadcast-channel-service', () => ({
  BroadcastChannelService: {
    getInstance: (): unknown => ({
      broadcastP2PNotification: (data: unknown): void => { broadcasts.push(data); },
    }),
  },
}));
vi.mock('@/lib/p2p/inbound-command-dispatch', () => ({
  dispatchInboundCommand: async (
    bytes: Uint8Array,
    _handle: (command: P2PCommand) => Promise<void>
  ): Promise<void> => { dispatched.push(bytes); },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));

const { MessageHandler } = await import('@/lib/p2p/message-handler');

function handler(): InstanceType<typeof MessageHandler> {
  const config: MessageHandlerConfig = {
    getCurrentCid: async (): Promise<bigint | null> => currentCid,
    isConnected: (): boolean => true,
    getConversations: (): Map<bigint, never> => new Map<bigint, never>(),
    updateMessageInPages: async (): Promise<boolean> => true,
    notifyMessageStatusListeners: (): void => {},
    getOrCreateConversation: (): never => { throw new Error('not under test'); },
    notifyMessageListeners: (): void => {},
    sendMessageAck: async (): Promise<void> => {},
    addMessageToConversation: async (): Promise<boolean> => true,
  } as unknown as MessageHandlerConfig;
  return new MessageHandler(config);
}

function notificationFor(recipient: bigint): InternalServiceResponse {
  return {
    MessageNotification: { cid: recipient, peer_cid: PEER, message: [1, 2, 3] },
  } as unknown as InternalServiceResponse;
}

describe('a MessageNotification arriving on the leader tab', () => {
  beforeEach((): void => {
    currentCid = null;
    dispatched.length = 0;
    broadcasts.length = 0;
  });

  it('is not processed by a tab that has no session — it is handed to the followers', async () => {
    currentCid = null;

    await handler().handleWebSocketMessage(notificationFor(OWNER));

    expect(dispatched, 'a tab logged into nobody adopted another session\'s message').toHaveLength(0);
    expect(broadcasts, 'refusing must be a hand-off to the owning tab, not a drop').toHaveLength(1);
  });

  it('is processed by the session it is addressed to', async () => {
    // Positive control: a guard that refused everything would pass above.
    currentCid = OWNER;

    await handler().handleWebSocketMessage(notificationFor(OWNER));

    expect(dispatched).toHaveLength(1);
    expect(broadcasts).toHaveLength(0);
  });

  it('is handed to the followers by a tab running as a different session', async () => {
    currentCid = OTHER;

    await handler().handleWebSocketMessage(notificationFor(OWNER));

    expect(dispatched).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
  });
});
