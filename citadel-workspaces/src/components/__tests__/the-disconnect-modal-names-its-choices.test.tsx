/**
 * The two destructive choices must be addressable by identity.
 *
 * This modal used to offer "Disconnect" and "Deregister", and its own comment
 * records why it stopped: it "read 'Deregister permanently removes this account
 * from the server' ... as if the difference were obvious". It now says "Sign
 * out" and "Delete account permanently", which is plainly better copy.
 *
 * `previous-sessions` pressed those buttons by their old words. From the day of
 * the rewording it found neither, and three of its checks have reported the
 * PRODUCT as broken ever since: Disconnect Removes, Deregister Removes,
 * Deregister Permanent.
 *
 * Worth noting what this case is not: the spec-copy gate cannot catch it.
 * "Disconnect" and "Deregister" both still appear elsewhere in the app, so
 * those strings exist — just not as the label of the thing being pressed.
 * Existing somewhere is not the same as being the name of the control.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisconnectConfirmModal } from '../DisconnectConfirmModal';

/**
 * Answerable, not always-yes.
 *
 * This mock returned `true` unconditionally, so no test here could see that
 * deleting an account asks a SECOND time -- and the integration spec did not
 * answer that dialog either, so clicking "Delete account permanently" returned
 * without deleting anything while three checks reported success.
 */
let secondConfirmationAnswer: boolean = true;
// jsdom has no IndexedDB: the sign-out's check for edits held on the device reads the stand-in (none held).
const deviceStore: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(deviceStore));
vi.mock('@/components/shared/confirm-dialog', () => ({
  useConfirm: (): (() => Promise<boolean>) => async (): Promise<boolean> => secondConfirmationAnswer,
}));

const SESSION: Parameters<typeof DisconnectConfirmModal>[0]['session'] = {
  cid: 42n,
  username: 'ada',
} as unknown as Parameters<typeof DisconnectConfirmModal>[0]['session'];

function renderModal(onConfirm: (action: 'disconnect' | 'deregister') => void): void {
  render(
    <DisconnectConfirmModal
      open
      onOpenChange={vi.fn()}
      session={SESSION}
      workspaceName="Design"
      onConfirm={onConfirm}
    />,
  );
}

describe('the disconnect confirmation', () => {
  it('offers signing out under a stable handle', async (): Promise<void> => {
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn();
    renderModal(onConfirm);

    await userEvent.click(screen.getByTestId('confirm-sign-out'));
    // After the check for edits held on the device (loaded on first use).
    await vi.waitFor((): void => expect(onConfirm).toHaveBeenCalledWith('disconnect'));
  });

  it('offers deleting the account under a different one', async (): Promise<void> => {
    // Two destructive choices one beside the other: the control that signs you
    // out and the control that destroys the account must never be reachable by
    // the same locator.
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn();
    renderModal(onConfirm);

    await userEvent.click(screen.getByTestId('confirm-delete-account'));
    await vi.waitFor((): void => expect(onConfirm).toHaveBeenCalledWith('deregister'));
  });
});

describe('the second confirmation on deleting an account', () => {
  it('does not delete when it is refused', async () => {
    secondConfirmationAnswer = false;
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn();
    renderModal(onConfirm);

    await userEvent.click(screen.getByTestId('confirm-delete-account'));

    expect(onConfirm).not.toHaveBeenCalled();
    secondConfirmationAnswer = true;
  });

  it('signing out is not asked twice', async () => {
    // Positive control, and the distinction that matters: the reversible
    // action goes through on one click even when the second question would be
    // refused.
    secondConfirmationAnswer = false;
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn();
    renderModal(onConfirm);

    await userEvent.click(screen.getByTestId('confirm-sign-out'));

    await vi.waitFor((): void => expect(onConfirm).toHaveBeenCalledWith('disconnect'));
    secondConfirmationAnswer = true;
  });
});

describe('signing out an account with edits held on this device', () => {
  it('asks first, and keeps the account signed in when deleting them is refused', async () => {
    const { documentEditsKey, localRecordPut } = await import('@/lib/document-replica-cache');
    await localRecordPut(documentEditsKey(42n, 'doc-1', 'tab-1'), [Uint8Array.from([1])]);
    secondConfirmationAnswer = false;
    const onConfirm: ReturnType<typeof vi.fn> = vi.fn();
    renderModal(onConfirm);

    await userEvent.click(screen.getByTestId('confirm-sign-out'));
    // Waited past the check, which settles before onConfirm would run.
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 50); });
    expect(onConfirm).not.toHaveBeenCalled();

    secondConfirmationAnswer = true;
    await userEvent.click(screen.getByTestId('confirm-sign-out'));
    await vi.waitFor((): void => expect(onConfirm).toHaveBeenCalledWith('disconnect'));
    deviceStore.clear();
  });
});
