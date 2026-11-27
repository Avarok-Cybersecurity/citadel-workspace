/**
 * A write takes its own answer: paired by request id with a server that pairs, and as before with
 * one that does not.
 *
 * Real: the capability handler, the frame extraction every server frame goes through, the pairing,
 * the write gate and the apps transport. The sender is the injected I/O boundary: it records what
 * would be sent, and the test plays the server's frames, as bytes, into the extraction.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWorkspacePayload, encodeWorkspaceRequest, type WorkspaceProtocolRequest, type WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { extractWorkspaceResponse } from '@/lib/workspace-response-handler/message-extraction';
import { handleGeneratedVariants } from '@/lib/workspace-response-handler/generated-variant-handlers';
import { answerPairing, sha256Hex } from '../answers/answer-pairing';
import { awaitWriteResponse, WRITE_RESPONSE_TIMEOUT_MS } from '../await-write-response';
import { listCatalogue, listInstalls, protocolAppsTransport, serialAppsTransport, type AppsResult } from '../apps-operations';
import type { ProtocolSender } from '../workspace-operations';

interface Sent { request: WorkspaceProtocolRequest; requestId: bigint | null }
function recording(): { sender: ProtocolSender; sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, sender: { currentCid: 1n, sendProtocolRequest: async (request: WorkspaceProtocolRequest, requestId: bigint | null): Promise<void> => { sent.push({ request, requestId }); } } };
}

/** The server's capabilities answer, through the real handler. */
function serverSays(requestIds: boolean | undefined): void {
  const response: WorkspaceProtocolResponse = { ServerCapabilities: {
    allow_server_file_transfer: false, allow_server_revfs_storage: false, max_file_transfer_size_mb: 1n, revfs_storage_quota_mb: 1n,
    ...(requestIds === undefined ? {} : { request_ids: requestIds }),
  } } as WorkspaceProtocolResponse;
  handleGeneratedVariants(response, { cid: 0, request_id: 'r' } as never);
}

/** One server frame as the page receives it; an unhandled response reaches the raw stream. */
function deliver(response: WorkspaceProtocolResponse): Uint8Array {
  const bytes: Uint8Array = encodeWorkspacePayload({ Response: response });
  const read: WorkspaceProtocolResponse | null = extractWorkspaceResponse({ MessageNotification: { message: bytes, cid: 1n, peer_cid: 0n } });
  if (read !== null) eventEmitter.emit('workspace:raw-response', read);
  return bytes;
}
async function pair(requestId: bigint, answer: Uint8Array): Promise<void> {
  deliver({ Answered: { request_id: requestId, digest: await sha256Hex(answer) } });
}
const digestsDone = (): Promise<void> => new Promise((r: () => void): void => { setTimeout(r, 30); });
const DELETE: WorkspaceProtocolRequest = { DeleteNode: { node_id: 'n1', cascade: false } };
const aboutN1 = (p: unknown): boolean => (p as { node_id?: string }).node_id === 'n1';

afterEach((): void => { answerPairing.setServerPairs(false); vi.useRealTimers(); });

describe('against a server that does not pair (built before request ids)', () => {
  it('sends no id, in the frame it always sent, and takes the next answer of the kind', async () => {
    serverSays(undefined);
    expect(encodeWorkspaceRequest(DELETE, null)).toEqual(encodeWorkspacePayload({ Request: DELETE }));
    const { sender, sent } = recording();
    const write: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1);
    await Promise.resolve();
    expect(sent).toEqual([{ request: DELETE, requestId: null }]);
    deliver({ NodeDeleted: { node_id: 'n1', children_deleted: [] } });
    await expect(write).resolves.toBeUndefined();
  });
});

describe('against a server that pairs', () => {
  it('names the request, and settles on its own paired answer', async () => {
    serverSays(true);
    const { sender, sent } = recording();
    const write: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1);
    await Promise.resolve();
    const id: bigint | null = sent[0].requestId;
    if (id === null) throw new Error('the request was not named');
    expect(new TextDecoder().decode(encodeWorkspaceRequest(DELETE, id))).toBe(`{"request_id":${id},"Request":{"DeleteNode":{"node_id":"n1","cascade":false}}}`);
    await pair(id, deliver({ NodeDeleted: { node_id: 'n1', children_deleted: [] } }));
    await expect(write).resolves.toBeUndefined();
  });

  it("is settled by neither another request's Error nor its pairing, only by its own answer", async () => {
    serverSays(true);
    const { sender, sent } = recording();
    let settled: string = 'pending';
    const write: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1)
      .then((): void => { settled = 'resolved'; }, (e: Error): void => { settled = e.message; });
    await Promise.resolve();
    const id: bigint = sent[0].requestId ?? 0n;
    deliver({ Error: 'Permission denied: someone else' });
    await pair(id + 1n, deliver({ Error: 'Permission denied: another request' }));
    await digestsDone();
    expect(settled).toBe('pending');
    await pair(id, deliver({ Error: 'Permission denied: EditTreeStructure required' }));
    await write;
    expect(settled).toBe('Permission denied: EditTreeStructure required');
  });

  it('a pairing that names no frame held (the agent kept the answer) fails it, never with another frame', async () => {
    serverSays(true);
    const { sender, sent } = recording();
    const write: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1);
    await Promise.resolve();
    // A broadcast that would satisfy the write by kind and payload, then a pairing naming other bytes.
    deliver({ NodeDeleted: { node_id: 'n1', children_deleted: [] } });
    await pair(sent[0].requestId ?? 0n, new TextEncoder().encode('{"Response":"never received"}'));
    await expect(write).rejects.toThrow(/could not be read/);
  });

  it('a late answer to a request that timed out is not taken by the next one', async () => {
    serverSays(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { sender, sent } = recording();
    const first: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1);
    const firstFailed: Promise<void> = expect(first).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS);
    await firstFailed;
    vi.useRealTimers();
    let settled: string = 'pending';
    const second: Promise<void> = awaitWriteResponse('DeleteNode', sender, DELETE, aboutN1)
      .then((): void => { settled = 'resolved'; }, (e: Error): void => { settled = e.message; });
    await Promise.resolve();
    await pair(sent[0].requestId ?? 0n, deliver({ Error: 'the first one, late' }));
    await digestsDone();
    expect(settled).toBe('pending');
    await pair(sent[1].requestId ?? 0n, deliver({ NodeDeleted: { node_id: 'n1', children_deleted: [] } }));
    await second;
    expect(settled).toBe('resolved');
  });

  it('the apps line is not held after a timeout: the next request goes at once and takes its own answer', async () => {
    serverSays(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { sender, sent } = recording();
    const t: ReturnType<typeof serialAppsTransport> = serialAppsTransport(protocolAppsTransport(sender));
    const first: Promise<AppsResult<unknown>> = listInstalls(t);
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS);
    expect(await first).toEqual({ ok: false, refusal: 'NoAnswer' });
    vi.useRealTimers();
    const second: Promise<AppsResult<unknown>> = listCatalogue(t);
    await digestsDone();
    expect(sent.map((s: Sent): unknown => s.request)).toEqual([{ Apps: 'ListInstalls' }, { Apps: 'ListCatalogue' }]);
    await pair(sent[0].requestId ?? 0n, deliver({ Apps: { Refused: 'Unavailable' } } as WorkspaceProtocolResponse));
    await pair(sent[1].requestId ?? 0n, deliver({ Apps: { Catalogue: { listings: [] } } } as WorkspaceProtocolResponse));
    expect(await second).toEqual({ ok: true, value: [] });
  });
});
