/**
 * A page's refusal is a plain `Error`, which names no request. A page used to take EVERY plain
 * Error it heard as its own denial, so another write's "Permission denied: EditMdx required" (a
 * rename the same member was refused, say) halted the page's edits. Against a server that pairs
 * answers, only the Error answering the page's own request denies it.
 *
 * Real: the response handler every server frame goes through, the pairing and the transport. The
 * sender records instead of writing to the agent's socket, which vitest cannot run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWorkspacePayload, type WorkspaceProtocolRequest, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import '@/lib/workspace-response-handler';
import { answerPairing, sha256Hex } from '@/lib/workspace-service/answers/answer-pairing';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';
import { workspaceDocumentsTransport } from '../documents-transport';
import type { DocumentsTransport } from '../ports';

const BOB: bigint = 18_170_202_856_123_884_154n;
const DENIED: string = 'Permission denied: EditMdx required';
const OTHER_REQUEST: bigint = 77n;

interface Sent { request: WorkspaceProtocolRequest; requestId: bigint | null }
function recordingSender(): { sender: ProtocolSender; sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, sender: { currentCid: BOB, sendProtocolRequest: async (request: WorkspaceProtocolRequest, requestId: bigint | null): Promise<void> => { sent.push({ request, requestId }); } } };
}

/** One server frame, as this tab's session receives it. */
function arrives(response: WorkspaceProtocolResponse): Uint8Array {
  const bytes: Uint8Array = encodeWorkspacePayload({ Response: response });
  eventEmitter.emit('websocket-message', { MessageNotification: { message: bytes, cid: BOB, peer_cid: 0n, request_id: null } });
  return bytes;
}
async function answers(requestId: bigint, response: WorkspaceProtocolResponse): Promise<void> {
  const bytes: Uint8Array = arrives(response);
  arrives({ Answered: { request_id: requestId, digest: await sha256Hex(bytes) } });
}
const digestsDone = (): Promise<void> => new Promise((r: () => void): void => { setTimeout(r, 30); });

function listening(transport: DocumentsTransport): string[] {
  const heard: string[] = [];
  transport.onError((message: string): void => { heard.push(message); });
  return heard;
}

afterEach((): void => { answerPairing.setServerPairs(false); });

describe('a page against a server that pairs answers', () => {
  it('is not denied by another request’s refusal, only by its own request’s', async () => {
    answerPairing.setServerPairs(true);
    const { sender, sent } = recordingSender();
    const transport: DocumentsTransport = workspaceDocumentsTransport(sender, null);
    const heard: string[] = listening(transport);
    await transport.send({ Append: { node_id: 'n1', doc_version: 2, update: new Uint8Array([1]), client_seq: 5n } });
    const own: bigint | null = sent[0].requestId;
    expect(own).not.toBeNull();

    await answers(OTHER_REQUEST, { Error: DENIED });
    await digestsDone();
    expect(heard).toEqual([]);

    await answers(own as bigint, { Error: DENIED });
    await digestsDone();
    expect(heard).toEqual([DENIED]);
  });

  it('a refusal nobody paired is not taken either', async () => {
    answerPairing.setServerPairs(true);
    const heard: string[] = listening(workspaceDocumentsTransport(recordingSender().sender, null));
    arrives({ Error: DENIED });
    await digestsDone();
    expect(heard).toEqual([]);
  });
});

describe('a page against a server that does not pair (built before request ids)', () => {
  it('sends what it always sent and hears every plain Error, as there is no telling whose', async () => {
    const { sender, sent } = recordingSender();
    const transport: DocumentsTransport = workspaceDocumentsTransport(sender, null);
    const heard: string[] = listening(transport);
    await transport.send({ Pull: { node_id: 'n1', since_seq: 4n } });
    expect(sent).toEqual([{ request: { Documents: { Pull: { node_id: 'n1', since_seq: 4n } } }, requestId: null }]);
    arrives({ Error: DENIED });
    expect(heard).toEqual([DENIED]);
  });
});
