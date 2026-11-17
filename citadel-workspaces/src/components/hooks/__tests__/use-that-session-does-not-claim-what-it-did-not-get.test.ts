/**
 * "Use That Session" does not announce a session it did not get.
 *
 * With a session held by another connection the claim now answers
 * `held-by-another-connection`, and the toast still said "Session restored --
 * you are now using the session that was already open". Nothing had moved.
 *
 * Mocked: the claim (a request to the agent).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sessions/claim-session', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  claimSessionForThisTab: async (): Promise<{ status: 'held-by-another-connection' }> => ({ status: 'held-by-another-connection' }),
}));

import { makeSessionAlreadyConnectedHandler } from '../session-already-connected';

interface ToastCall { title?: string; action?: { onClick: () => void } }

describe('Use That Session', () => {
  it('says the session is elsewhere rather than restored', async () => {
    const toasts: ToastCall[] = [];
    const handler: ReturnType<typeof makeSessionAlreadyConnectedHandler> = makeSessionAlreadyConnectedHandler({
      toast: (o: Record<string, unknown>): void => { toasts.push(o as ToastCall); },
      setState: vi.fn(),
    });
    await handler({ cid: '7', message: 'Session Already Connected' });
    toasts[0].action?.onClick();
    await vi.waitFor(() => expect(toasts.length).toBe(2));

    expect(toasts[1].title).toBe('Open in another browser window');
  });
});
