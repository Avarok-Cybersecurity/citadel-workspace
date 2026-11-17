/**
 * Waiting briefly for a just-promoted leader's socket to exist.
 *
 * A tab that has won leadership is active before its socket is created, and
 * failing a proxied request in that window loses a real user operation to a
 * race they cannot see. It matters most in exactly the case that produces it: a
 * backgrounded leader has its heartbeat timer throttled by the browser to
 * roughly once a minute against a five second dead-leader timeout, so a
 * foreground follower challenges, briefly activates, and is demoted again by
 * the real leader's next event-driven reply — which is not throttled.
 *
 * Bounded, because holding indefinitely is the opposite mistake. With no socket
 * coming at all, an unbounded hold leaves the follower waiting out the queue's
 * retries rather than being told quickly that nobody is listening. The window
 * sits well under that retry deadline, so a flap resolves inside it and a
 * genuine absence still fails at about the time it always did.
 *
 * Polled rather than event-driven because the send function is registered by
 * assignment with no announcement, and adding an event for this would be a
 * second thing to keep in step with the first.
 */

const SOCKET_READY_WINDOW_MS: number = 1500;
const POLL_MS: number = 50;

export async function waitForSocket(read: () => unknown): Promise<boolean> {
  const deadline: number = Date.now() + SOCKET_READY_WINDOW_MS;

  while (!read() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return Boolean(read());
}
