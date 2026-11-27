/**
 * "Plan & billing" over the member's own session: `OpenBillingPortal`, answered with
 * `BillingPortal`. The server decides from the session's account whether this member may manage
 * the plan; a refusal (no permission, or a server with no billing) is an `Error` answer, which
 * rejects here, and the dialog then offers the claim code instead.
 *
 * The answer's `portal_url` is a bearer link to the subscription: it is handed back to the caller
 * and never logged.
 */
import type { BillingPortalAnswer } from 'citadel-workspace-client-ts';
import { awaitWriteResponse } from './await-write-response';
import type { ProtocolSender } from './workspace-operations';

/** The answer a `BillingPortal` payload carries, or null for anything else. */
export function parseBillingPortalAnswer(payload: unknown): BillingPortalAnswer | null {
  if (payload === 'NoSubscription' || payload === 'NotConfigured') return payload;
  if (!payload || typeof payload !== 'object') return null;
  const record: Record<string, unknown> = payload as Record<string, unknown>;
  const opened: unknown = record.Opened;
  if (opened && typeof opened === 'object') {
    const url: unknown = (opened as Record<string, unknown>).portal_url;
    if (typeof url === 'string') return { Opened: { portal_url: url } };
  }
  const unavailable: unknown = record.Unavailable;
  if (unavailable && typeof unavailable === 'object') {
    const reason: unknown = (unavailable as Record<string, unknown>).reason;
    if (typeof reason === 'string') return { Unavailable: { reason } };
  }
  return null;
}

/** Sends `OpenBillingPortal` and resolves with the server's answer; rejects with its refusal. */
export async function openBillingPortal(sender: ProtocolSender): Promise<BillingPortalAnswer> {
  let answered: BillingPortalAnswer | null = null;
  await awaitWriteResponse('OpenBillingPortal', sender, 'OpenBillingPortal', (payload: unknown): boolean => {
    answered = parseBillingPortalAnswer(payload);
    return answered !== null;
  });
  if (answered === null) throw new Error("OpenBillingPortal: the server's answer carried no portal answer");
  return answered;
}
