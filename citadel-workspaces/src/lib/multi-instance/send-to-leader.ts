/**
 * Proxy one request through the leader tab and wait for its ack.
 *
 * Extracted from InstanceChannel to keep that class under the file cap; the
 * behaviour is unchanged, including the ack listener's cleanup and the outer
 * timeout that resolves rather than rejects.
 */
import { eventEmitter } from '../event-emitter';
import { outboundQueue, type AckResult, type ProxyResponseData } from './outbound-queue';
import { TIMEOUT } from '@/lib/timeout-constants';
import { isInert } from './tab-staleness';

type OutboundMessage = Parameters<typeof import('./instance-channel').instanceChannel.send>[0];

export function sendToLeader(
  channel: { send: (m: OutboundMessage) => void },
  payload: unknown,
  requestId?: string,
): Promise<AckResult> {
  const id: string = requestId || crypto.randomUUID();
  // Another tab speaks a protocol this build cannot: it is read-only until reloaded.
  if (isInert()) return Promise.resolve({ status: 'error', error: 'This tab is out of date. Reload it to continue.' });

  return new Promise((resolve) => {
    outboundQueue.enqueue(payload, id);

    const ackHandler = (event: { requestId: string; status: 'processed' | 'error'; error?: string; data?: ProxyResponseData }): void => {
      if (event.requestId === id) {
        clearTimeout(timeout);
        eventEmitter.off('outbound-ack', ackHandler);
        eventEmitter.off('outbound-failed', failedHandler);
        resolve({ status: event.status, error: event.error, data: event.data });
      }
    };

    // The queue gives up before this promise's own deadline does, and said so
    // to nobody.
    //
    // `outbound-queue` retries a proxied request MAX_RETRIES times on a
    // deadline deliberately shorter than the 30s below, then emits
    // `outbound-failed` and drops it. Nothing listened, so the caller went on
    // waiting for an ack that the queue had already stopped trying to obtain --
    // about ten seconds of a spinner over a decision already taken.
    //
    // Settled with the same shape the timeout produces, and the queue has
    // already removed the entry, so nothing here re-acknowledges it.
    const failedHandler = (event: { requestId: string; error?: string }): void => {
      if (event.requestId !== id) return;
      clearTimeout(timeout);
      eventEmitter.off('outbound-ack', ackHandler);
      eventEmitter.off('outbound-failed', failedHandler);
      resolve({ status: 'error', error: event.error ?? 'The leader never acknowledged this request' });
    };

    eventEmitter.on('outbound-ack', ackHandler);
    eventEmitter.on('outbound-failed', failedHandler);

    const timeout: NodeJS.Timeout = setTimeout((): void => {
      eventEmitter.off('outbound-ack', ackHandler);
      eventEmitter.off('outbound-failed', failedHandler);
      // Drop it from the queue. The ack path calls acknowledge(); this one did
      // not, so a timed-out request stayed in the map forever — and
      // `onLeaderChange` replays every queued entry. The caller had ALREADY
      // been told the request failed and had surfaced that to the user, and
      // then the identical payload was silently re-sent to the next leader,
      // and again at every leader change after that. A Connect, a workspace
      // mutation or a P2P message could be executed minutes later, repeatedly,
      // with nothing in the UI to say so.
      outboundQueue.acknowledge(id, {
        status: 'error',
        error: 'Timeout waiting for ACK from leader',
      });
      resolve({ status: 'error', error: 'Timeout waiting for ACK from leader' });
    }, TIMEOUT.OUTBOUND_ACK_MS);

    channel.send({ type: 'outbound-request', targetInstanceId: 'leader', requestId: id, payload });
  });
}
