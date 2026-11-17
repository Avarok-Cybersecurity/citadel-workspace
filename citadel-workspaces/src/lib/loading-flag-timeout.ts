/**
 * A deadline for a loading flag.
 *
 * These flags are raised when a request is SENT and lowered when its event
 * arrives — `WorkspaceService.listX()` resolves on send, not on response. If the
 * response never comes (socket drop, a server that answered Error, a dropped
 * frame) the flag stays raised and the surface spins forever.
 *
 * The honest fallback is the empty state: after the deadline we stop claiming to
 * be loading, so the UI says "nothing here" — which is at least a statement the
 * user can act on — rather than a spinner that will never resolve.
 *
 * Raising the flag at all is the fix for the opposite failure: the flags had no
 * writer, so every list rendered its empty state as fact while data was in
 * flight. This module exists so fixing that one does not introduce this one.
 */

const timers: Map<string, NodeJS.Timeout> = new Map<string, ReturnType<typeof setTimeout>>();

/** How long to wait before deciding a response is not coming. */
export const LOADING_DEADLINE_MS: number = 15_000;

/** Start (or restart) the deadline for `key`. */
export function armLoadingDeadline(key: string, onExpired: () => void): void {
  cancelLoadingDeadline(key);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      onExpired();
    }, LOADING_DEADLINE_MS)
  );
}

/** The response arrived (or the component went away). */
export function cancelLoadingDeadline(key: string): void {
  const existing: NodeJS.Timeout | undefined = timers.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(key);
  }
}
