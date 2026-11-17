import { useEffect, useState } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import {
  noticeStillApplies,
  shutdownNotice,
  type ServerShutdown,
} from '@/lib/server-shutdown-notice';

/**
 * The sentence to show while the server is restarting, or null.
 *
 * `server:shutdown` was emitted and nothing listened. See
 * `server-shutdown-notice` for what that cost.
 *
 * Cleared on the next successful connection, and on a timer, because a restart
 * that never came back stops being the explanation: leaving it up tells the
 * user to keep waiting for something that is not coming.
 */
export function useServerShutdown(): string | null {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let expiry: number | undefined;

    const onShutdown = (payload: ServerShutdown): void => {
      const announcedAt: number = Date.now();
      setNotice(shutdownNotice(payload));
      window.clearTimeout(expiry);
      // One timer, set from the same rule the predicate uses, so the two cannot
      // disagree about how long the notice lasts.
      const remaining: number = (payload.drainSeconds + 30) * 1_000;
      expiry = window.setTimeout(() => {
        if (!noticeStillApplies(payload, announcedAt, Date.now())) setNotice(null);
      }, remaining);
    };

    const onBack = (): void => {
      window.clearTimeout(expiry);
      setNotice(null);
    };

    eventEmitter.on('server:shutdown', onShutdown);
    eventEmitter.on('on-ws-connection-success', onBack);
    return (): void => {
      window.clearTimeout(expiry);
      eventEmitter.off('server:shutdown', onShutdown);
      eventEmitter.off('on-ws-connection-success', onBack);
    };
  }, []);

  return notice;
}
