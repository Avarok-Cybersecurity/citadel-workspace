/**
 * "Encryption Level: Security level for this conversation" did nothing.
 *
 * Three controls in `ChatSettingsPanel`'s General tab were uncontrolled —
 * `defaultValue`, no `value`, no `onChange`, no store, no consumer:
 *
 *   Encryption Level      Standard / High / Maximum
 *   Connection Priority   P2P First / Server First / Auto
 *   Message Retention     a slider whose "90 days" label is static text, so
 *                         dragging it did not move the number it was setting
 *
 * The file's own comment, on the switches directly above them, says why this
 * is not acceptable here:
 *
 *   they were uncontrolled `Switch defaultChecked` here, with no handler and no
 *   store … On a product whose subject is privacy, a switch that lies about
 *   what you are broadcasting is the worst kind to fake.
 *
 * Those switches were fixed. Their three siblings in the same tab were not, and
 * one of them claims to set an encryption level.
 *
 * `PrivacySettingsTab` already had the honest pattern for a control this build
 * cannot act on: disable it and say so. That note is now shared.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({ p2pMessengerManager: {} }));
const { ChatSettingsPanel } = await import('../ChatSettingsPanel');
const { ConfirmDialogProvider } = await import('@/components/shared/confirm-dialog');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');

/** The three live in the Advanced tab, and an inactive tab panel does not mount. */
async function openAdvanced(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: /advanced/i }));
}

function panel(): void {
  // The signed-in session the per-chat settings belong to.
  instanceManager.setCid(41n);
  render(
    <ConfirmDialogProvider>
    <ChatSettingsPanel
      isOpen={true}
      onClose={(): void => {}}
      peerCid="42"
      peerName="alice"
    />
    </ConfirmDialogProvider>,
  );
}

/**
 * The controls that still have nothing behind them. Message Retention and the
 * Encryption Level are enforced (see the retention tests and
 * lib/p2p/__tests__/a-chat-level-change-reopens-the-live-link.test.ts; the SDK
 * fix is Citadel-Protocol 539e416d). Connection Priority cannot be from this
 * client -- the relay policy must match on both peers and the offer does not
 * carry it.
 */
const INERT: readonly string[] = [];
/** Not offered at all: nothing can honour it from one side (see ChatSettingsAdvanced). */
const NOT_OFFERED: readonly string[] = ['connection-priority'];
const ENFORCED: readonly string[] = ['message-retention', 'encryption-level'];

/** The row a control sits in: the nearest ancestor that also holds its label. */
function rowOf(id: string): HTMLElement {
  const label: HTMLElement = document.querySelector(`label[for="${id}"]`) as HTMLElement;
  let node: HTMLElement | null = label;
  while (node && !node.contains(document.getElementById(id))) node = node.parentElement;
  if (!node) throw new Error(`no row holds ${id}`);
  return node;
}

describe('a settings control with nothing behind it', () => {
  it('is disabled rather than pretending to work', async () => {
    panel();
    await openAdvanced();
    for (const id of INERT) {
      const control: HTMLElement = document.getElementById(id) as HTMLElement;
      expect(control, id).toBeTruthy();
      expect((control as HTMLInputElement).disabled, id).toBe(true);
      expect(rowOf(id).textContent, id).toMatch(/not enforced yet/i);
    }
  });

  it('is the only one that says so', async () => {
    panel();
    await openAdvanced();
    // The note beside an enforced control would be the opposite lie.
    expect(screen.queryAllByText(/not enforced yet/i)).toHaveLength(INERT.length);
    for (const id of NOT_OFFERED) expect(document.getElementById(id), id).toBeNull();
    for (const id of ENFORCED) {
      const control: HTMLElement = document.getElementById(id) as HTMLElement;
      expect(control, id).toBeTruthy();
      // Disabled only until this chat's saved settings have been read.
      await waitFor((): void => { expect((control as HTMLInputElement).disabled, id).toBe(false); });
      expect(rowOf(id).textContent, id).not.toMatch(/not enforced yet/i);
    }
  });

  it('leaves the controls that do work alone', async () => {
    // The positive control. Read receipts and typing indicators are bound to
    // the privacy store and enforced in the send paths; disabling everything
    // would satisfy the test above and break two settings that work.
    panel();
    const readReceipts: HTMLElement = document.getElementById('read-receipts') as HTMLElement;
    expect(readReceipts).toBeTruthy();
    expect(readReceipts.getAttribute('disabled')).toBeNull();
    await userEvent.click(readReceipts);
  });
});
