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
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { viewOf } from '@/test-utils/request-view';
import type { RequestBody } from '@/types/workspace-protocol';
import { createDocument } from '../document-operations';
import type { ProtocolSender } from '../workspace-operations';

type CreateNodeRequest = RequestBody<'CreateNode'>;

/** A sender that records the request and answers it as the server would. */
function answeringSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequest[] } {
  const sent: WorkspaceProtocolRequest[] = [];
  const sender: ProtocolSender = {
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequest): Promise<void> => {
      sent.push(request);
      const create: CreateNodeRequest | undefined = viewOf(request).CreateNode;
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
    const create: CreateNodeRequest | undefined = viewOf(sent[0]).CreateNode;
    if (create === undefined) throw new Error('the first request sent was not CreateNode');
    expect(create.parent_id).toBe('alex');
    expect(create.entity_type).toEqual({ Child: 'Floor' });
    expect(create.name).toBe('Plan');
    expect(create.metadata).toBeDefined();
    expect(decodeNodeApp(create.metadata ?? null)).toEqual({ kind: 'document', app: 'docs' });
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
