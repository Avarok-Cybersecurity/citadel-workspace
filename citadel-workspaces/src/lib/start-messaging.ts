
import type { NotificationService } from '@/lib/notification-service/service';/**
 * Start the ILM messenger for a session, and refuse to do it silently.
 *
 * `wasmConnectionManager.start` opens the ILM messenger handle. The comment
 * above one of its call sites states the stakes in capitals: without it, ACKs
 * are never sent for inbound messages, so outbound messages block waiting for
 * ACKs that will never come. Messaging is the product.
 *
 * All three call sites — login, orphan claim, and the shared session-startup
 * sequence — caught the failure into a `debugLog`, one of them into a bare
 * `catch (_) { }`. `debugLog` is stripped from production builds, so a failure
 * here produced no toast, no notification, no console line and no record of any
 * kind. The login path then announced "Login successful — connected to
 * workspace successfully" and handed the user a workspace whose messaging was
 * dead.
 *
 * The excuse in the old catch was "P2P may still work without ILM". It might;
 * but the user is the one who should learn that their messages are not going
 * anywhere, and they should learn it at the moment it happens rather than from
 * the silence where a reply should have been.
 *
 * I/O is injected so the decision is testable without standing up the WASM
 * client or the notification service.
 */

export interface MessagingStartDeps {
  /** Opens the ILM messenger handle for this session. */
  start: (cid: string) => Promise<void>;
  /** Raises a durable, user-visible record that messaging is unavailable. */
  report: (title: string, detail: string) => void;
}

export const MESSAGING_UNAVAILABLE_TITLE: "Messaging unavailable" = 'Messaging unavailable';

function describe(error: unknown): string {
  const reason: string = error instanceof Error ? error.message : String(error);
  return `Messages cannot be sent or received for this session: ${reason}. Reload the page to try again.`;
}

/**
 * Returns whether messaging came up. Callers that report success to the user
 * should consult it rather than assuming.
 */
export async function startMessagingOrReport(
  cid: string,
  deps: MessagingStartDeps,
): Promise<boolean> {
  try {
    await deps.start(cid);
    return true;
  } catch (error) {
    deps.report(MESSAGING_UNAVAILABLE_TITLE, describe(error));
    return false;
  }
}

/**
 * The deps every real call site uses: the WASM connection manager, and a HIGH
 * system notification. A notification rather than a toast because this is a
 * standing condition, not an event — a toast that has already faded cannot
 * answer "why has nobody replied to me?" ten minutes later.
 */
export async function startMessagingForSession(cid: string): Promise<boolean> {
  const [{ wasmConnectionManager }, notifications] = await Promise.all([
    import('./wasm-connection-manager'),
    import('./notification-service'),
  ]);
  const service: NotificationService = notifications.default.getInstance();
  return startMessagingOrReport(cid, {
    start: (id) => wasmConnectionManager.start(id),
    report: (title, detail) =>
      service.addSystemNotification(title, detail, notifications.NotificationPriority.HIGH),
  });
}
