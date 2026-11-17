/**
 * A request in flight when the socket drops must fail immediately.
 *
 * The internal service keys responses to the connection that asked, and a
 * reconnect is a new connection with a new uuid — so a request sent on a socket
 * that has since died can never be answered. It used to sit out its full budget
 * anyway, and the budgets are long: 30s for a peer connect or a disconnect, 35s
 * for a peer list, 60s for a file download, 120s for the file picker. The user
 * watches a spinner for a minute over a socket that is gone, and is then told
 * the request "timed out", which names the wrong cause.
 */
import { describe, it, expect, vi  } from 'vitest';
import { requestResponse, requestResponseSoft } from '../request-response';
import { eventEmitter } from '../../event-emitter';

const never: { matchSuccess: () => undefined; matchFailure: () => undefined; } = { matchSuccess: (): undefined => undefined, matchFailure: (): undefined => undefined };

/** A request that has been sent and is waiting. */
function pending(timeoutMs: number = 60_000): Promise<string> {
  return requestResponse<string>({
    request: { Whatever: { request_id: 'r1' } },
    requestId: 'r1',
    sendRequest: async () => {},
    timeoutMs,
    operationName: 'FileDownload',
    matcher: never,
  });
}

describe('a pending request', () => {
  it('fails as soon as the socket drops, not when its budget runs out', async () => {
    const promise: Promise<string> = pending();
    // Let `sendRequest` settle so the listener is certainly registered.
    await Promise.resolve();
    eventEmitter.emit('websocket-disconnected', { reason: 'closed' });
    await expect(promise).rejects.toThrow(/connection to the Citadel agent was lost/);
  });

  it('names the operation, so the message says what was lost', async () => {
    const promise: Promise<string> = pending();
    await Promise.resolve();
    eventEmitter.emit('websocket-disconnected', { reason: 'closed' });
    await expect(promise).rejects.toThrow(/FileDownload/);
  });

  it('still resolves normally when the response arrives', async () => {
    const promise: Promise<string> = requestResponse<string>({
      request: { Whatever: { request_id: 'r2' } },
      requestId: 'r2',
      sendRequest: async () => {},
      timeoutMs: 60_000,
      operationName: 'GetSessions',
      matcher: {
        matchSuccess: (msg) => (msg.ok === true ? 'answered' : undefined),
        matchFailure: () => undefined,
      },
    });
    await Promise.resolve();
    eventEmitter.emit('websocket-message', { ok: true });
    await expect(promise).resolves.toBe('answered');
  });

  it('leaves no listener behind once it has settled', async () => {
    const before: number = eventEmitter.listenerCount('websocket-disconnected');
    const promise: Promise<string> = pending();
    await Promise.resolve();
    expect(eventEmitter.listenerCount('websocket-disconnected')).toBe(before + 1);
    eventEmitter.emit('websocket-disconnected', { reason: 'closed' });
    await promise.catch(() => {});
    // A drop is exactly when many requests fail at once; a listener kept per
    // failed request would accumulate one per drop, forever.
    expect(eventEmitter.listenerCount('websocket-disconnected')).toBe(before);
  });

  it('is not left waiting by the soft variant either', async () => {
    const onFailure: ReturnType<typeof vi.fn> = vi.fn();
    const promise: Promise<void> = requestResponseSoft({
      request: { Whatever: { request_id: 'r3' } },
      requestId: 'r3',
      sendRequest: async () => {},
      timeoutMs: 120_000,
      operationName: 'PickFile',
      matchSuccess: () => false,
      matchFailure: () => undefined,
      onFailure,
    });
    await Promise.resolve();
    eventEmitter.emit('websocket-disconnected', { reason: 'closed' });
    await promise;
    expect(onFailure).toHaveBeenCalledWith(expect.stringMatching(/PickFile failed/));
  });
});
