/**
 * The compound actions a window asks the agent for, through the real request
 * path (requests.ts over requestResponse). The socket is the one stand-in: a
 * sender that records each request and answers the way the agent does, on the
 * app's event emitter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ConversationEvent } from 'citadel-internal-service-wasm-client';
import { sendThroughAgent, reactThroughAgent, type AgentActionDeps } from '../agent-actions';
import { registerConversationSender } from '../requests';
import { eventEmitter } from '../../event-emitter';
import type { P2PMessage } from '../../p2p/p2p-types';

const ME: bigint = 11n;
const BOB: bigint = 22n;

type Answer = (variant: string, body: Record<string, unknown>) => void;
const asked: Array<[string, Record<string, unknown>]> = [];
let answer: Answer = () => {};
const watchers: Set<(e: ConversationEvent) => void> = new Set();

function stored(id: string, extra: Partial<P2PMessage> = {}): P2PMessage {
  return { id, content: 'hi', senderCid: ME, recipientCid: BOB, timestamp: 1, index: 1, status: 'sent', message_type: 'text', ...extra };
}

function appended(requestId: string): ConversationEvent {
  return {
    cid: ME, peer_cid: BOB, seq: 1n, kind: 'Appended', message: stored('m1', { status: 'pending' }), message_id: 'm1', metadata: null,
    account_username: 'me', peer_username: 'bob', preview: 'hi', request_id: requestId,
  };
}

const respond = (variant: string, body: Record<string, unknown>): void => { eventEmitter.emit('websocket-message', { [variant]: body }); };

function deps(found: P2PMessage | null = null): AgentActionDeps {
  return {
    ownCid: async () => ME,
    securityLevel: async () => 'Reinforced',
    findMessage: async () => found,
    onEvent: (l) => { watchers.add(l); return () => { watchers.delete(l); }; },
    now: () => 5,
  };
}

beforeEach(() => {
  asked.length = 0;
  watchers.clear();
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
    asked.push([variant, body]);
    queueMicrotask(() => answer(variant, body));
  });
});

describe('sending through the agent', () => {
  it('clears the composer when the agent announces the stored message, once', async () => {
    let cleared: number = 0;
    answer = (_v: string, body: Record<string, unknown>): void => {
      for (const watch of [...watchers]) watch(appended(String(body.request_id)));
      expect(cleared).toBe(1);
      respond('ConversationUpdated', { request_id: body.request_id, cid: ME, peer_cid: BOB, message: stored('m1') });
    };
    const sent: P2PMessage = await sendThroughAgent(deps(), BOB, 'hi', { onOptimisticAppend: () => { cleared += 1; } });
    expect(sent.id).toBe('m1');
    expect(cleared).toBe(1);
    expect(watchers.size).toBe(0);
    const [variant, body] = asked[0];
    expect(variant).toBe('ConversationSend');
    expect(body).toMatchObject({ cid: ME, peer_cid: BOB, content: 'hi', message_type: 'text', reply_to: null, security_level: 'Reinforced' });
  });

  it('keeps the composer when the agent refuses before storing anything', async () => {
    let cleared: number = 0;
    answer = (_v: string, body: Record<string, unknown>): void => respond('ConversationFailure', { request_id: body.request_id, message: 'no session' });
    await expect(sendThroughAgent(deps(), BOB, 'hi', { onOptimisticAppend: () => { cleared += 1; } })).rejects.toThrow('no session');
    expect(cleared).toBe(0);
    expect(watchers.size).toBe(0);
  });

  it('clears the composer on success even when no Appended event came first', async () => {
    let cleared: number = 0;
    answer = (_v: string, body: Record<string, unknown>): void => respond('ConversationUpdated', { request_id: body.request_id, message: stored('m1') });
    await sendThroughAgent(deps(), BOB, 'hi', { onOptimisticAppend: () => { cleared += 1; } });
    expect(cleared).toBe(1);
  });

  it('ignores another request\'s Appended event', async () => {
    let cleared: number = 0;
    answer = (_v: string, body: Record<string, unknown>): void => {
      for (const watch of [...watchers]) watch(appended('someone-else'));
      expect(cleared).toBe(0);
      respond('ConversationFailure', { request_id: body.request_id, message: 'down' });
    };
    await expect(sendThroughAgent(deps(), BOB, 'hi', { onOptimisticAppend: () => { cleared += 1; } })).rejects.toThrow('down');
    expect(cleared).toBe(0);
  });
});

describe('reacting through the agent', () => {
  const done: Answer = (_v, body) => respond('ConversationUpdated', { request_id: body.request_id, message: null });

  it('adds a reaction we have not made', async () => {
    answer = done;
    await reactThroughAgent(deps(stored('m1')), BOB, 'm1', '👍');
    expect(asked[0]).toEqual(['ConversationReact', expect.objectContaining({ message_id: 'm1', emoji: '👍', active: true })]);
  });

  it('takes back a reaction we have made', async () => {
    answer = done;
    const mine: P2PMessage = stored('m1', { reactions: [{ emoji: '👍', reactorCid: ME, at: 1, active: true }] });
    await reactThroughAgent(deps(mine), BOB, 'm1', '👍');
    expect(asked[0][1]).toMatchObject({ emoji: '👍', active: false });
  });

  it('refuses a message it cannot find, without asking', async () => {
    await expect(reactThroughAgent(deps(null), BOB, 'gone', '👍')).rejects.toThrow('not in this conversation');
    expect(asked).toEqual([]);
  });
});
