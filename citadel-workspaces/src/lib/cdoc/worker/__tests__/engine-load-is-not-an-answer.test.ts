/**
 * The worker's one unasked message, the engine's download: read by the page's loading bar and
 * never taken for the answer to a request. WorkerCdocClient over a real MessageChannel (node's).
 */
import { describe, expect, it } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { WorkerCdocClient, type WorkerLike } from '../clients';
import { isCdocResponse } from '../protocol';
import { isEngineLoadMessage, type EngineLoadMessage } from '../engine-load';

const DOWNLOADING: EngineLoadMessage = { engineLoad: { kind: 'downloading', bytes: { loaded: 4, total: 10 } } };

describe('the engine load message', () => {
  it('is told apart from answers in both directions', () => {
    expect(isEngineLoadMessage(DOWNLOADING)).toBe(true);
    expect(isEngineLoadMessage({ engineLoad: { kind: 'ready' } })).toBe(true);
    expect(isCdocResponse(DOWNLOADING)).toBe(false);
    expect(isEngineLoadMessage({ id: 1, ok: true, result: {} })).toBe(false);
    expect(isEngineLoadMessage({ engineLoad: { kind: 'downloading', bytes: { loaded: '4', total: 10 } } })).toBe(false);
    expect(isEngineLoadMessage({ engineLoad: { kind: 'waiting' } })).toBe(false);
  });

  it('leaves a pending request pending, which its real answer then settles', async () => {
    const { port1, port2 } = new MessageChannel();
    port2.on('message', (request: { readonly id: number }): void => {
      port2.postMessage(DOWNLOADING);
      port2.postMessage({ id: request.id, ok: true, result: { slot: 3 } });
    });
    port1.start();
    const client: WorkerCdocClient = new WorkerCdocClient(port1 as unknown as WorkerLike, (): void => port1.close());
    await expect(client.request({ kind: 'detachCanvas', slot: 3 })).resolves.toEqual({ slot: 3 });
    client.dispose();
    port2.close();
  });
});
