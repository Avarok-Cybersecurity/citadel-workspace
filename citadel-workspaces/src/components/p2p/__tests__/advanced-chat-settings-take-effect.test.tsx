/**
 * Choosing a retention period in Chat settings -> Advanced is saved for this
 * chat and acted on at once.
 *
 * Stood in, each for a stated reason:
 *   - `retentionChanged`: it reads and rewrites the agent's LocalDB. The pruning
 *     itself is pinned in retention-deletes-what-is-older-than-the-period.
 *   - the messenger singleton, as the sibling panel test does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const OURS: bigint = 3001n;
const PEER: bigint = 3002n;

vi.mock('@/lib/p2p/p2p-messenger-manager', () => ({ p2pMessengerManager: {} }));

const retained: bigint[] = [];
vi.mock('@/lib/p2p/retention-sweep', () => ({
  retentionChanged: async (peer: bigint): Promise<number> => { retained.push(peer); return 0; },
}));

const { ChatSettingsPanel } = await import('../ChatSettingsPanel');
const { ConfirmDialogProvider } = await import('@/components/shared/confirm-dialog');
const { chatAdvancedSettings } = await import('@/lib/p2p/chat-advanced-settings');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');

async function openAdvanced(): Promise<void> {
  render(
    <ConfirmDialogProvider>
      <ChatSettingsPanel isOpen={true} onClose={(): void => {}} peerCid={PEER.toString()} peerName="bob" />
    </ConfirmDialogProvider>,
  );
  await userEvent.click(screen.getByRole('tab', { name: /advanced/i }));
}

describe('Advanced chat settings', () => {
  beforeEach((): void => {
    localStorage.clear();
    retained.length = 0;
    instanceManager.setCid(OURS);
  });

  it('shows what is saved for this chat', async () => {
    await chatAdvancedSettings.set(OURS, PEER, { retention: 30 });
    await openAdvanced();
    await waitFor((): void => {
      expect((document.getElementById('message-retention') as HTMLSelectElement).value).toBe('30');
    });
  });

  it('saves a retention period and applies it now', async () => {
    await openAdvanced();
    await userEvent.selectOptions(document.getElementById('message-retention') as HTMLSelectElement, '7');

    await waitFor(async (): Promise<void> => {
      expect((await chatAdvancedSettings.get(OURS, PEER)).retention).toBe(7);
      expect(retained).toEqual([PEER]);
    });
  });

  it('says retention applies to this device only', async () => {
    await openAdvanced();
    expect(screen.getByText(/deleted from this device/i)).toBeTruthy();
    expect(screen.getByText(/bob's copy is not affected/i)).toBeTruthy();
  });
});
