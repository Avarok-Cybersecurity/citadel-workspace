/**
 * A note in the scratchpad goes to the agent to keep, and asks for no connection: no
 * auto-connect, no CheckState, nothing addressed to the account's own cid (lib/scratchpad).
 *
 * Real: the sender and the agent request path (requests.ts over requestResponse). Stood in: the
 * socket beneath that path (a recorder answering the way the agent does), and the auto-connect
 * and registration services, whose real versions dial through the WASM client; their spies are
 * what this test reads, since a dial is exactly what must not happen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageSender, type MessageSenderConfig } from '../message-sender';
import { registerConversationSender } from '../../agent-conversations/requests';
import { eventEmitter } from '../../event-emitter';
import { p2pAutoConnectService } from '../../p2p-auto-connect-service';
import { p2pRegistrationService } from '../../p2p-registration-service';
import type { AgentActionDeps } from '../../agent-conversations/agent-actions';
import type { P2PMessage } from '../p2p-types';

const ME: bigint = 91n;
const BOB: bigint = 92n;
const asked: string[] = [];
const readied: bigint[] = [];

const agent = (): AgentActionDeps => ({
  ownCid: async () => ME,
  securityLevel: async () => 'Standard',
  findMessage: async () => null,
  onEvent: () => () => undefined,
  now: () => 1,
  keepsNotesToSelf: async () => true,
});

function sender(): MessageSender {
  const unused = (): never => { throw new Error('not reached by sendMessage'); };
  return new MessageSender({
    getCurrentCid: async () => ME,
    isConnected: () => true,
    tryEnsurePeerReady: async (peer: bigint) => { readied.push(peer); return true; },
    agent,
    getOrCreateConversation: unused, addMessageToConversation: unused, findStoredMessage: unused, updateMessageInPages: unused,
    emitEvent: unused, notifyMessageListeners: unused, notifyMessageStatusListeners: unused,
  } as unknown as MessageSenderConfig);
}

const stored = (peer: bigint): P2PMessage => ({ id: 'm1', content: 'n', sender_cid: ME, recipient_cid: peer, timestamp: 1, index: 1, status: 'sent', message_type: 'text' });

beforeEach(() => {
  asked.length = 0;
  readied.length = 0;
  vi.spyOn(p2pRegistrationService, 'isPeerRegistered').mockReturnValue(true);
  vi.spyOn(p2pAutoConnectService, 'isPeerConnected').mockResolvedValue(true);
  vi.spyOn(p2pAutoConnectService, 'ensurePeerConnectedInBackground').mockResolvedValue(undefined as never);
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    asked.push(variant);
    queueMicrotask(() => eventEmitter.emit('websocket-message', {
      ConversationUpdated: { request_id: body.request_id, cid: ME, peer_cid: body.peer_cid, message: stored(body.peer_cid as bigint) },
    }));
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('sending in the scratchpad', () => {
  it('hands the note to the agent and dials nobody', async () => {
    await sender().sendMessage(ME, 'buy oat milk');
    expect(asked).toEqual(['ConversationSend']);
    expect(p2pAutoConnectService.ensurePeerConnectedInBackground).not.toHaveBeenCalled();
    expect(p2pAutoConnectService.isPeerConnected).not.toHaveBeenCalled();
    expect(readied).toEqual([]);
  });

  it('still connects to someone else first', async () => {
    await sender().sendMessage(BOB, 'hi');
    expect(asked).toEqual(['ConversationSend']);
    expect(p2pAutoConnectService.ensurePeerConnectedInBackground).toHaveBeenCalledWith(BOB);
    expect(readied).toEqual([BOB]);
  });
});
