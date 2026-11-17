/**
 * The leader passes on what its agent says about its notifier.
 *
 * Only the leader has a socket, so only it hears `NoticesHeardNotification`
 * (capabilities.ts). A follower raises OS notifications for its own session's
 * messages, and decides who owns each one from the same value
 * (notification-service/owner.ts), so the leader broadcasts every change; a
 * follower applies it in channel-message-dispatch.ts. A follower that starts
 * later reads the value as it stands in the leader's answer to its question
 * about capabilities.
 */
import type { ValueStore } from '../value-store';

export interface NoticesHeardRelayDeps {
  store: ValueStore<boolean>;
  isLeader: () => boolean;
  /** Tell every other tab. */
  send: (heard: boolean) => void;
}

export function installNoticesHeardRelay(deps: NoticesHeardRelayDeps): void {
  deps.store.subscribe((): void => {
    if (deps.isLeader()) deps.send(deps.store.get());
  });
}

/** What a 'notices-heard' channel message says, or null for a malformed one. */
export function noticesHeardFromChannel(payload: unknown): boolean | null {
  const heard: unknown = (payload as { heard?: unknown } | null | undefined)?.heard;
  return typeof heard === 'boolean' ? heard : null;
}
