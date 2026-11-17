/**
 * Creating a document is a CreateNode whose metadata names the app, at the level the caller
 * read from the schema; an app that is not available yet, or a blank name, never reaches the
 * wire.
 *
 * Mocked: the protocol sender only. It is the boundary to the WASM socket; the request it is
 * handed is what the server receives, and the answer is emitted the way the response handler
 * emits it, so `createNode` and the write gate run for real.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { decodeNodeApp } from '@/lib/citadel-apps/node-app-metadata';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { createDocument } from '../document-operations';
import type { ProtocolSender } from '../workspace-operations';

type CreateNodeRequest = NonNullable<WorkspaceProtocolRequestTS['CreateNode']>;

/** A sender that records the request and answers it as the server would. */
function answeringSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequestTS[] } {
  const sent: WorkspaceProtocolRequestTS[] = [];
  const sender: ProtocolSender = {
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequestTS): Promise<void> => {
      sent.push(request);
      const create: CreateNodeRequest | undefined = request.CreateNode;
      if (create) setTimeout(() => eventEmitter.emit('workspace:raw-response', { Node: { id: 'new', parent_id: create.parent_id, name: create.name } }), 0);
    }),
  } as unknown as ProtocolSender;
  return { sender, sent };
}

describe('creating a document', () => {
  it('sends CreateNode at the schema level with the app in its metadata', async () => {
    const { sender, sent } = answeringSender();
    await createDocument(sender, { parentId: 'alex', childType: 'Floor', name: ' Plan ', app: 'docs' });

    expect(sent).toHaveLength(1);
    const create: CreateNodeRequest = sent[0].CreateNode as CreateNodeRequest;
    expect(create.parent_id).toBe('alex');
    expect(create.entity_type).toEqual({ Child: 'Floor' });
    expect(create.name).toBe('Plan');
    expect(create.metadata).toBeDefined();
    expect(decodeNodeApp(create.metadata ?? [])).toBe('docs');
  });

  it('refuses an app that is not available yet, sending nothing', async () => {
    const { sender, sent } = answeringSender();
    await expect(createDocument(sender, { parentId: 'alex', childType: 'Floor', name: 'Scan', app: 'pdf' })).rejects.toThrow(/not available/);
    expect(sent).toHaveLength(0);
  });

  it('refuses a blank name, sending nothing', async () => {
    const { sender, sent } = answeringSender();
    await expect(createDocument(sender, { parentId: 'alex', childType: 'Floor', name: '   ', app: 'docs' })).rejects.toThrow(/name/);
    expect(sent).toHaveLength(0);
  });
});
