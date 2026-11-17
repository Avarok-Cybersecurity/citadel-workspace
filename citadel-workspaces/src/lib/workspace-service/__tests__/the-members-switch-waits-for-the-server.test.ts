/**
 * "Members can see each other" is saved when the server says so, not on send.
 *
 * Real: the operation, the write gate and the event bus. The sender is the
 * injected I/O boundary, so nothing is mocked; it records the frame instead of
 * sending it.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { setMembersVisible } from '../node-operations';
import type { ProtocolSender } from '../workspace-operations';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';

function recordingSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequestTS[] } {
  const sent: WorkspaceProtocolRequestTS[] = [];
  const sender: ProtocolSender = {
    currentCid: 1n,
    sendProtocolRequest: async (request: WorkspaceProtocolRequestTS): Promise<void> => { sent.push(request); },
  };
  return { sender, sent };
}

/** Drains the microtask queue: a resolution several `then` hops away lands here. */
async function drainMicrotasks(): Promise<void> {
  for (let i: number = 0; i < 20; i += 1) await Promise.resolve();
}

describe('setMembersVisible', () => {
  it('sends the switch for the node and resolves on that node coming back', async () => {
    const { sender, sent } = recordingSender();
    let settled: boolean = false;
    const write: Promise<void> = setMembersVisible(sender, 'o1', false).then((): void => { settled = true; });
    await Promise.resolve();
    expect(sent).toEqual([{ SetMembersVisible: { node_id: 'o1', visible: false } }]);

    // Another node's broadcast is not this write's answer.
    eventEmitter.emit('workspace:raw-response', { Node: { id: 'o2' } });
    await drainMicrotasks();
    expect(settled).toBe(false);

    eventEmitter.emit('workspace:raw-response', { Node: { id: 'o1' } });
    await write;
    expect(settled).toBe(true);
  });

  it("rejects with the server's refusal", async () => {
    const { sender } = recordingSender();
    const write: Promise<void> = setMembersVisible(sender, 'o1', false);
    await Promise.resolve();
    eventEmitter.emit('workspace:raw-response', {
      Error: 'Permission denied: only an admin can change who sees the member list',
    });
    await expect(write).rejects.toThrow('only an admin');
  });
});
