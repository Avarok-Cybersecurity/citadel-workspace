/**
 * A document shared in a node's chat on the production path: its requests leave inside the
 * `ChatDocuments` envelope, and its answers reach only its own transport. Its updates name the
 * same node as the page, so a page that heard them would merge a chat document into itself.
 *
 * The sender records requests instead of writing to the WASM socket, which vitest cannot run.
 */
import { describe, expect, it } from 'vitest';
import { encodeWorkspacePayload, type DocumentsResponse, type WorkspaceProtocolPayload, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import '@/lib/workspace-response-handler';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { workspaceDocumentsTransport } from '../documents-transport';
import type { DocumentsTransport } from '../ports';

const BOB: bigint = 18_170_202_856_123_884_154n;
const DOC_A: string = 'cdoc-3f2a9c1e-7b4d-4e8a-9f01-2c3d4e5f6a7b';
const DOC_B: string = 'cdoc-0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const PUSH: DocumentsResponse = { DocumentUpdated: { node_id: 'n1', seq: 3n, doc_version: 2, update: [1, 2], author_cid: 7n } };

function pushOf(response: WorkspaceProtocolResponse): Record<string, unknown> {
  const payload: WorkspaceProtocolPayload = { Response: response };
  return { MessageNotification: { message: Array.from(encodeWorkspacePayload(payload)), cid: BOB, peer_cid: 0n, request_id: 'the-authors-request' } };
}

function recordingSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequestTS[] } {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return { sent, sender: { currentCid: BOB, sendProtocolRequest: (request: WorkspaceProtocolRequestTS): Promise<void> => { sent.push(request); return Promise.resolve(); } } };
}

function listen(transport: DocumentsTransport): { heard: DocumentsResponse[]; stop: () => void } {
  const heard: DocumentsResponse[] = [];
  return { heard, stop: transport.onResponse((response: DocumentsResponse): void => { heard.push(response); }) };
}

describe('a chat document on the production path', () => {
  it('sends its requests inside the ChatDocuments envelope', async () => {
    const { sender, sent } = recordingSender();
    await workspaceDocumentsTransport(sender, DOC_A).send({ Pull: { node_id: 'n1', since_seq: 0n } });
    expect(sent).toEqual([{ ChatDocuments: { chat_doc: DOC_A, request: { Pull: { node_id: 'n1', since_seq: 0n } } } }]);
  });

  it('hears its own answers, and the page and the other documents of the node never do', () => {
    const { sender } = recordingSender();
    const page: { heard: DocumentsResponse[]; stop: () => void; } = listen(workspaceDocumentsTransport(sender, null));
    const a: { heard: DocumentsResponse[]; stop: () => void; } = listen(workspaceDocumentsTransport(sender, DOC_A));
    const b: { heard: DocumentsResponse[]; stop: () => void; } = listen(workspaceDocumentsTransport(sender, DOC_B));
    eventEmitter.emit('websocket-message', pushOf({ ChatDocuments: { chat_doc: DOC_A, answer: PUSH } }));
    eventEmitter.emit('websocket-message', pushOf({ Documents: PUSH }));
    for (const listener of [page, a, b]) listener.stop();
    expect({ page: page.heard, a: a.heard, b: b.heard }).toEqual({ page: [PUSH], a: [PUSH], b: [] });
  });

  it('hears no plain Error: every refusal about it comes addressed', () => {
    const { sender } = recordingSender();
    const errors: string[] = [];
    const stop: () => void = workspaceDocumentsTransport(sender, DOC_A).onError((message: string): void => { errors.push(message); });
    eventEmitter.emit('workspace:raw-response', { Error: 'Permission denied: EditMdx required' });
    stop();
    expect(errors).toEqual([]);
  });
});
