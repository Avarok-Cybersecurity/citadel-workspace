/**
 * What to say when the server tells us it is going away.
 *
 * `ServerShutdown` carries a message and a drain window, and the response
 * handler emits `server:shutdown` with both. Its own comment says why the
 * variant exists — *"Distinct from `Error` so the UI can show a reconnect
 * notice rather than a red toast on a planned restart"* — and nothing in the
 * app listened for it. The server announced a planned restart, the client threw
 * the announcement away, and thirty seconds later the user got the same generic
 * connection failure they would have got from a crash.
 *
 * Pure, so the sentence can be read and tested without a socket. The server's
 * own message is shown when it sent one, because an operator restarting for a
 * known reason has said something more useful than anything this file can
 * guess.
 */

export interface ServerShutdown {
  /** The operator's words, if any. */
  message: string;
  /** How long the server expects to be draining, in seconds. */
  drainSeconds: number;
}

/** How long after the announcement the notice stops being the explanation. */
export const SHUTDOWN_NOTICE_GRACE_SECONDS: 30 = 30;

export function shutdownNotice(shutdown: ServerShutdown): string {
  const trimmed: string = shutdown.message.trim();
  // Rounded up, and never "0 seconds": a drain the server reports as
  // sub-second is still a restart, and "back in a moment" is what a person
  // needs to read.
  const seconds: number = Math.max(0, Math.ceil(shutdown.drainSeconds));
  const when: string =
    seconds <= 0
      ? 'It should be back in a moment.'
      : `It should be back in about ${seconds} second${seconds === 1 ? '' : 's'}.`;
  return trimmed === '' ? `The server is restarting. ${when}` : `${trimmed} ${when}`;
}

/**
 * Whether an announcement still explains what the user is seeing.
 *
 * A restart that was announced two minutes ago and has not come back is no
 * longer a planned restart from the user's point of view; leaving the notice up
 * would be telling them to keep waiting for something that is not coming.
 */
export function noticeStillApplies(
  shutdown: ServerShutdown,
  announcedAtMs: number,
  nowMs: number,
): boolean {
  const window: number = (shutdown.drainSeconds + SHUTDOWN_NOTICE_GRACE_SECONDS) * 1_000;
  return nowMs - announcedAtMs < window;
}
