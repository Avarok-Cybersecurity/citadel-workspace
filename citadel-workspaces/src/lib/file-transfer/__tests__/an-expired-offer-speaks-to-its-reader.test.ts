/**
 * An expired offer tells each side what THEY can do.
 *
 * Found live (2026-09-29): on files johndoesky had sent, his own bubbles read
 * "Offer expired — ask the sender to send it again." He is the sender. The
 * reason was one sentence for both sides of the conversation.
 */
import { describe, it, expect } from 'vitest';
import { transferView, STALE_OFFER_REASON, STALE_SENT_OFFER_REASON, type TransferMessageFields, type TransferView } from '../transfer-view';

const restoredPending: TransferMessageFields = { transfer_state: 'pending' };

describe('an offer restored from storage with nothing left to answer it', () => {
  it('tells the recipient to ask the sender', () => {
    expect(transferView(restoredPending, undefined, false, 'received')).toEqual({ state: 'expired', progress: 0, reason: STALE_OFFER_REASON, resuming: false, resendable: false });
  });

  it('tells the sender to send it again, not to ask themselves', () => {
    const view: TransferView = transferView(restoredPending, undefined, false, 'sent');
    expect(view.state).toBe('expired');
    expect(view.reason).toBe(STALE_SENT_OFFER_REASON);
    expect(view.reason).not.toMatch(/ask the sender/i);
  });

  it('is still live, for either side, while the offer is arriving', () => {
    expect(transferView(restoredPending, undefined, true, 'sent').state).toBe('pending');
    expect(transferView(restoredPending, undefined, true, 'received').state).toBe('pending');
  });
});
