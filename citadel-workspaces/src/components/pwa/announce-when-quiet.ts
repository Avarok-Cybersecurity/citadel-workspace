/**
 * Hold an ambient announcement until the user is not being told something failed.
 *
 * "Ready to work offline — Citadel has been installed and will now load without
 * a connection" is a capability notice with no deadline. It fired the moment
 * the service worker finished, which on a first run is the same moment the user
 * may be reading **"Could not reach the server."**
 *
 * Measured, registering against an unreachable workspace server:
 *
 *   Connection Error   Could not reach the server. Please check the server address…
 *   Ready to work offline   Citadel has been installed and will now load without a connection.
 *
 * Two notices side by side, one saying the connection failed and the other that
 * a connection is not needed. On a failed action a green success toast reads as
 * though something worked.
 *
 * So the ambient one waits for quiet. Bounded, and it is still shown when the
 * wait expires: the notice is true, it was only badly timed, and dropping it
 * would trade a confusing message for a missing one.
 */

/** How long to wait for the error to clear before announcing anyway. */
export const QUIET_WAIT_MS: number = 12_000;
/** How often to look. */
export const QUIET_POLL_MS: number = 500;

/** Whether an error notification is currently on screen. */
export function anErrorIsShowing(doc: Pick<Document, 'querySelector'> = document): boolean {
  return doc.querySelector('[data-sonner-toast][data-type="error"]') !== null;
}

/**
 * Run `announce` once the screen is quiet, or when the wait expires.
 *
 * Returns a cancel function, because the component that schedules this can
 * unmount first — a timer that fires into a dead component is the other half of
 * the listener leaks this codebase has collected.
 */
export function announceWhenQuiet(
  announce: () => void,
  options: { isBusy?: () => boolean; waitMs?: number; pollMs?: number } = {},
): () => void {
  const isBusy: () => boolean = options.isBusy ?? ((): boolean => anErrorIsShowing());
  const waitMs: number = options.waitMs ?? QUIET_WAIT_MS;
  const pollMs: number = options.pollMs ?? QUIET_POLL_MS;

  if (!isBusy()) {
    announce();
    return () => undefined;
  }

  let done: boolean = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    clearInterval(poll);
    clearTimeout(giveUp);
    announce();
  };

  const poll: NodeJS.Timeout = setInterval((): void => {
    if (!isBusy()) finish();
  }, pollMs);
  const giveUp: NodeJS.Timeout = setTimeout(finish, waitMs);

  return () => {
    done = true;
    clearInterval(poll);
    clearTimeout(giveUp);
  };
}
