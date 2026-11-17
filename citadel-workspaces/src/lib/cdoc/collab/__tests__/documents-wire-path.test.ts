/**
 * The production path of a Documents message through this tab: the server's push arrives in a
 * MessageNotification addressed to the session's cid, which the multi-tab router routes by cid
 * (MessageNotification is in CID_ROUTED_NOTIFICATIONS, so no new routing rule is needed); the
 * response handler decodes it with the u64-exact codec and emits DOCUMENTS_EVENT; the
 * transport hands it to the session. Requests leave as `{ Documents: … }` on the sender.
 *
 * The sender below records requests instead of writing to the WASM socket: that socket is the
 * agent, which vitest cannot run.
 */
import { describe, expect, it } from 'vitest';
import { encodeWorkspacePayload, type DocumentsResponse, type WorkspaceProtocolPayload } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { reconnectingTo } from '@/lib/reconnect/server-reconnect';
import { extractRequestId, extractTargetCid } from '@/lib/multi-instance/message-routing';
import '@/lib/workspace-response-handler';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';
import type { WorkspaceProtocolRequestTS } from '@/types/workspace-protocol';
import { workspaceDocumentsTransport } from '../documents-transport';
import type { DocumentsTransport, LinkState } from '../ports';

const BOB: bigint = 18_170_202_856_123_884_154n;
const ALICE: bigint = 1_281_805_798_482_117_626n;

function serverPush(to: bigint, response: DocumentsResponse): Record<string, unknown> {
  const payload: WorkspaceProtocolPayload = { Response: { Documents: response } };
  return { MessageNotification: { message: Array.from(encodeWorkspacePayload(payload)), cid: to, peer_cid: 0n, request_id: 'the-authors-request' } };
}

function recordingSender(): { sender: ProtocolSender; sent: WorkspaceProtocolRequestTS[] } {
  const sent: WorkspaceProtocolRequestTS[] = [];
  return { sent, sender: { currentCid: BOB, sendProtocolRequest: (request: WorkspaceProtocolRequestTS): Promise<void> => { sent.push(request); return Promise.resolve(); } } };
}

const PUSH: DocumentsResponse = { DocumentUpdated: { node_id: 'n1', seq: 9_007_199_254_740_993n, doc_version: 2, update: [0, 255, 7], author_cid: ALICE } };

describe('a Documents message on the production path', () => {
  it('is routed by the recipient cid, never by the author\'s request id', () => {
    const message: Record<string, unknown> = serverPush(BOB, PUSH);
    expect(extractRequestId(message)).toBeNull();
    expect(extractTargetCid(message)).toBe(BOB.toString());
  });

  it('reaches the transport decoded, u64s exact', () => {
    const { sender } = recordingSender();
    const transport: DocumentsTransport = workspaceDocumentsTransport(sender, null);
    const heard: DocumentsResponse[] = [];
    const stop: () => void = transport.onResponse((response: DocumentsResponse): void => { heard.push(response); });
    eventEmitter.emit('websocket-message', serverPush(BOB, PUSH));
    stop();
    expect(heard).toEqual([PUSH]);
  });

  it('sends requests as the Documents sub-protocol', async () => {
    const { sender, sent } = recordingSender();
    await workspaceDocumentsTransport(sender, null).send({ Pull: { node_id: 'n1', since_seq: 4n } });
    expect(sent).toEqual([{ Documents: { Pull: { node_id: 'n1', since_seq: 4n } } }]);
  });

  it('follows its own session\'s link, not another\'s', () => {
    const { sender } = recordingSender();
    const states: LinkState[] = [];
    const stop: () => void = workspaceDocumentsTransport(sender, null).onLink((state: LinkState): void => { states.push(state); });
    eventEmitter.emit('websocket-message', { ServerConnectionLost: { cid: ALICE, reconnecting: true, request_id: null } });
    eventEmitter.emit('websocket-message', { ServerConnectionLost: { cid: BOB, reconnecting: true, request_id: null } });
    eventEmitter.emit('websocket-message', { ServerReconnected: { cid: BOB, request_id: null } });
    stop();
    expect(states).toEqual(['down', 'up']);
  });

  it('starts with the link the tab shows: down while the agent re-dials this tab\'s session', () => {
    const { sender } = recordingSender();
    reconnectingTo.set('workspace.example:12349');
    expect(workspaceDocumentsTransport(sender, null).link()).toBe('down');
    reconnectingTo.set(null);
    expect(workspaceDocumentsTransport(sender, null).link()).toBe('up');
  });

  it('hears a permission refusal', () => {
    const { sender } = recordingSender();
    const errors: string[] = [];
    const stop: () => void = workspaceDocumentsTransport(sender, null).onError((message: string): void => { errors.push(message); });
    eventEmitter.emit('workspace:raw-response', { Error: 'Permission denied: EditMdx required' });
    stop();
    expect(errors).toEqual(['Permission denied: EditMdx required']);
  });

  it('refuses to open without a signed-in session', () => {
    expect(() => workspaceDocumentsTransport({ currentCid: null, sendProtocolRequest: (): Promise<void> => Promise.resolve() }, null)).toThrow('signed-in session');
  });
});
