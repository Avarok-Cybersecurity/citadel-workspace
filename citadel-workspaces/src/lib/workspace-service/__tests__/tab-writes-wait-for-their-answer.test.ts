/**
 * A node's tabs and the workspace default are saved when the server says so.
 *
 * Real: the operations, the write gate and the event bus. The sender is the injected I/O
 * boundary; it records the frame instead of sending it.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { setDefaultAppTabs, writeNodeTabs } from '../node-tabs-operations';
import type { ProtocolSender } from '../workspace-operations';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';

function recordingSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequestTS[] } {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return { sent, sender: { currentCid: 1n, sendProtocolRequest: async (r: WorkspaceProtocolRequestTS): Promise<void> => { sent.push(r); } } };
}
const bytes = (doc: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(doc)));
async function drain(): Promise<void> { for (let i: number = 0; i < 20; i += 1) await Promise.resolve(); }

describe('writing tabs', () => {
  it('sends the list as a metadata patch, and resolves on this node carrying it', async () => {
    const { sender, sent } = recordingSender();
    let settled: boolean = false;
    const write: Promise<void> = writeNodeTabs(sender, 'n1', ['com.acme.kanban']).then((): void => { settled = true; });
    await Promise.resolve();
    const patch: number[] | undefined = sent[0]?.UpdateNode?.metadata;
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(patch ?? [])))).toEqual({ app_tabs: ['com.acme.kanban'] });

    // Another member's broadcast of the same node with the old list is not this write's answer.
    eventEmitter.emit('workspace:raw-response', { Node: { id: 'n1', metadata: bytes({ app_tabs: [] }) } });
    await drain();
    expect(settled).toBe(false);
    eventEmitter.emit('workspace:raw-response', { Node: { id: 'n1', metadata: bytes({ app_tabs: ['com.acme.kanban'] }) } });
    await write;
    expect(settled).toBe(true);
  });

  it('removes the list with null, answered by the node without it', async () => {
    const { sender, sent } = recordingSender();
    const write: Promise<void> = writeNodeTabs(sender, 'n1', null);
    await Promise.resolve();
    expect(new TextDecoder().decode(new Uint8Array(sent[0]?.UpdateNode?.metadata ?? []))).toBe('{"app_tabs":null}');
    eventEmitter.emit('workspace:raw-response', { Node: { id: 'n1', metadata: bytes({ keep: 1 }) } });
    await expect(write).resolves.toBeUndefined();
  });

  it("sets the workspace default, and rejects with the server's refusal", async () => {
    const { sender, sent } = recordingSender();
    const write: Promise<void> = setDefaultAppTabs(sender, ['net.avarok.calendar']);
    await Promise.resolve();
    expect(sent).toEqual([{ SetDefaultAppTabs: { app_tabs: ['net.avarok.calendar'] } }]);
    eventEmitter.emit('workspace:raw-response', { Error: 'Permission denied: EditWorkspaceConfig is required to set the default tabs' });
    await expect(write).rejects.toThrow('EditWorkspaceConfig');
  });
});
