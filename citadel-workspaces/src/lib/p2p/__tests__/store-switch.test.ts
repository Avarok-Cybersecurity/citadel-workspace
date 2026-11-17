/**
 * The conversation store a window reads and writes is the agent's when the
 * agent hosts the account, and the browser-written one otherwise -- decided per
 * call, from what the agent answered on this socket.
 *
 * The browser store is a recording stand-in; the agent side is the real
 * agentStore over the real request path, answered on the event emitter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { switchedStore } from '../store-switch';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import { registerConversationSender } from '@/lib/agent-conversations/requests';
import { toPatch } from '@/lib/agent-conversations/agent-store';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { eventEmitter } from '@/lib/event-emitter';

const ME: bigint = 7n;


const browserCalls: string[] = [];
const browser: { loadAllMetadata(): Promise<string> } = { async loadAllMetadata(): Promise<string> { browserCalls.push('loadAllMetadata'); return 'browser'; } };
const asked: string[] = [];

beforeEach(async () => {
  browserCalls.length = 0;
  asked.length = 0;
  instanceManager.setCid(ME);
  registerConversationSender(async (request: Record<string, unknown>): Promise<void> => {
    const [variant, body] = Object.entries(request)[0] as [string, { request_id: string }];
    asked.push(variant);
    queueMicrotask(() => eventEmitter.emit('websocket-message', { ConversationListResponse: { request_id: body.request_id, cid: ME, conversations: [] } }));
  });
});

describe('the switching conversation store', () => {
  it('asks the agent when it hosts the account, and never writes here', async () => {
    await greetAs(true);
    expect(await switchedStore(browser).loadAllMetadata()).toEqual([]);
    expect(asked).toEqual(['ConversationList']);
    expect(browserCalls).toEqual([]);
  });

  it('uses the browser store for an agent that does not', async () => {
    await greetAs('older');
    expect(await switchedStore(browser).loadAllMetadata()).toBe('browser');
    expect(asked).toEqual([]);
  });
});

describe('what a window may patch on a message the agent stores', () => {
  it('passes delivery and transfer state', () => {
    expect(toPatch({ status: 'failed', error: 'x', transfer_progress: 3 })).toEqual({ status: 'failed', error: 'x', transfer_progress: 3 });
  });

  it('refuses the rest: content, reactions and identity are the agent\'s actions', () => {
    expect(() => toPatch({ content: 'rewritten' })).toThrow('content');
  });
});
