/**
 * Clearing a conversation asks first, and a refusal clears nothing.
 *
 * Round 418 found the file-manager delete paths behind a `confirm({...})` that
 * no test at any level exercised, and round 417 found what that costs: a
 * deregistration that silently did nothing while three checks reported success.
 * This was the third such guard, and the last one still uncovered.
 *
 * The button also had no testid, so nothing could address it. Its own comment
 * records the previous defect here -- it used to remove a localStorage key
 * nothing in the app has ever written, so it cleared nothing while the dialog
 * promised the messages were gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatSettingsPanel } from '../ChatSettingsPanel';

let answer: boolean = true;
const cleared: bigint[] = [];

vi.mock('@/components/shared/confirm-dialog', () => ({
  useConfirm: (): (() => Promise<boolean>) => async (): Promise<boolean> => answer,
}));
vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({
  p2pMessengerManager: {
    clearConversationHistory: async (cid: bigint): Promise<void> => { cleared.push(cid); },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: () => void } => ({ toast: (): void => {} }) }));

async function openPanel(): Promise<void> {
  render(<ChatSettingsPanel isOpen onClose={(): void => {}} peerCid="42" peerName="bob" />);
  // The control lives on the Advanced tab, which is not the one that opens.
  await userEvent.click(screen.getByTestId('tab-advanced'));
}

describe('clearing chat history', () => {
  beforeEach((): void => { answer = true; cleared.length = 0; });

  it('clears nothing when the question is refused', async (): Promise<void> => {
    answer = false;
    await openPanel();
    await userEvent.click(screen.getByTestId('clear-chat-history'));
    expect(cleared).toEqual([]);
  });

  it('clears this conversation when it is accepted', async (): Promise<void> => {
    // Positive control: the guard must not block an accepted clear, and the
    // cid it clears must be the peer's.
    await openPanel();
    await userEvent.click(screen.getByTestId('clear-chat-history'));
    expect(cleared).toEqual([42n]);
  });
});
