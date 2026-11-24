/**
 * `OpenBillingPortal` resolves with what the SERVER answered for this session, and a refusal (no
 * permission, no billing host) rejects with the server's reason, which the dialog turns into the
 * claim-code fallback.
 *
 * Doubled: the send (the wire) and the inbound event, as every write-gate test here does; the
 * request shape, the gate and the parsing are the production ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import type { WorkspaceProtocolRequest } from 'citadel-workspace-client-ts';
import { openBillingPortal, parseBillingPortalAnswer } from '../billing-portal';
import type { ProtocolSender } from '../workspace-operations';

type Sender = ProtocolSender & { sent: WorkspaceProtocolRequest[] };

const PORTAL: string = 'https://billing.stripe.com/p/session/test_fixture';

/** A sender whose server answers each request with `answers`. */
function sender(answers: unknown[]): Sender {
  const sent: WorkspaceProtocolRequest[] = [];
  return {
    sent,
    currentCid: 7n,
    sendProtocolRequest: vi.fn(async (request: WorkspaceProtocolRequest): Promise<void> => {
      sent.push(request);
      for (const response of answers) setTimeout(() => eventEmitter.emit('workspace:raw-response', response), 0);
    }),
  };
}

describe('OpenBillingPortal', () => {
  it('sends the bare request -- no CID, no flag -- and resolves with the opened portal', async () => {
    const s: Sender = sender([{ BillingPortal: { Opened: { portal_url: PORTAL } } }]);
    expect(await openBillingPortal(s)).toEqual({ Opened: { portal_url: PORTAL } });
    expect(s.sent).toEqual(['OpenBillingPortal']);
  });

  it('resolves with a plan that has nothing to manage', async () => {
    expect(await openBillingPortal(sender([{ BillingPortal: 'NoSubscription' }]))).toBe('NoSubscription');
  });

  it('rejects with the server\'s refusal', async () => {
    const s: Sender = sender([{ Error: "Permission denied: EditWorkspaceConfig is required to manage this workspace's plan" }]);
    await expect(openBillingPortal(s)).rejects.toThrow('Permission denied');
  });

  it('reads only the answer shapes the server sends', () => {
    expect(parseBillingPortalAnswer('NotConfigured')).toBe('NotConfigured');
    expect(parseBillingPortalAnswer({ Unavailable: { reason: 'x' } })).toEqual({ Unavailable: { reason: 'x' } });
    expect(parseBillingPortalAnswer({ Opened: { portal_url: 5 } })).toBeNull();
    expect(parseBillingPortalAnswer('Opened')).toBeNull();
    expect(parseBillingPortalAnswer(null)).toBeNull();
  });
});
