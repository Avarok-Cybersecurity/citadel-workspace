/**
 * Settings -> Sign-in keys says so when the account's recovery phrase was never checked, and
 * offers a new phrase as the fix. A new phrase that is checked clears the reminder; one whose
 * check is skipped keeps it.
 *
 * Doubled at the I/O seams, as sign-in-keys-are-the-servers.test.tsx does: the agent and
 * authenticator (sign-in fakes) via the composition root, the tab selection; and IndexedDB, which
 * jsdom does not have (fake-indexeddb is not a dependency), with the structured-clone Map double.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { World } from '@/lib/sign-in/__tests__/helpers';

const h: { w: World; records: Map<string, unknown> } = vi.hoisted(() => ({ w: undefined as unknown as World, records: new Map<string, unknown>() }));
vi.mock('@/lib/tab-context', async (orig: () => Promise<Record<string, unknown>>) => ({
  ...(await orig()),
  getSelectedUser: async (): Promise<Record<string, unknown>> => ({ selectedUsername: 'alice', selectedCid: 7n, selectedServerAddress: 'bench.work.avarok.net' }),
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getTabSelectedSession: async (): Promise<null> => null } }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), browserSignInDeps: (): World['deps'] => h.w.deps }));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), passkeysAvailableHere: (): boolean => true }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(h.records));

import { SignInKeysSection } from '../passkey/SignInKeysSection';
import { SecurityKeyPrompt } from '../sign-in/SecurityKeyPrompt';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { tenantOf } from '@/lib/sign-in/factors';
import { isPhraseUnchecked, recordPhraseCheck, type PhraseAccount } from '@/lib/recovery/phrase-unchecked';
import { PHRASE_COPY } from '@/lib/recovery/copy';

const ALICE: PhraseAccount = { tenant: tenantOf('bench.work.avarok.net'), cid: 7n };
const PASSWORD: string = 'correct horse battery';

async function newPhraseFromTheReminder(): Promise<string[]> {
  render(<><SignInKeysSection /><SecurityKeyPrompt /></>);
  expect(await screen.findByTestId('recovery-phrase-unchecked')).toHaveTextContent(PHRASE_COPY.uncheckedReminder);
  fireEvent.click(screen.getByTestId('recovery-phrase-unchecked-fix'));
  fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByTestId('step-up-submit'));
  const shown: string[] = (await screen.findAllByTestId('recovery-phrase-word')).map((li) => li.lastElementChild?.textContent ?? '');
  fireEvent.click(screen.getByTestId('recovery-phrase-written'));
  return shown;
}

beforeEach(() => {
  h.w = world(false);
  h.records.clear();
  h.w.agent.account('alice');
});
afterEach(() => h.w.stop());

describe('an unchecked recovery phrase in Settings', () => {
  it('is named, with "Make a new phrase" as the fix', async () => {
    await recordPhraseCheck(ALICE, false);
    render(<><SignInKeysSection /><SecurityKeyPrompt /></>);
    expect(await screen.findByTestId('recovery-phrase-unchecked')).toHaveTextContent(PHRASE_COPY.uncheckedReminder);
    expect(screen.getByTestId('recovery-phrase-unchecked-fix')).toHaveTextContent(PHRASE_COPY.uncheckedFix);
  });

  it('is not mentioned for an account whose phrase was checked', async () => {
    render(<><SignInKeysSection /><SecurityKeyPrompt /></>);
    expect(await screen.findByTestId('show-sign-in-keys')).toBeInTheDocument();
    // The account is known once the button shows; let its stored answer land before asking for absence.
    await act(async (): Promise<void> => { await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); }); });
    expect(screen.queryByTestId('recovery-phrase-unchecked')).toBeNull();
  });

  it('is cleared by a new phrase whose words are typed back', async () => {
    await recordPhraseCheck(ALICE, false);
    const shown: string[] = await newPhraseFromTheReminder();
    screen.getAllByTestId('recovery-phrase-check-word').forEach((box: HTMLElement) => {
      fireEvent.change(box, { target: { value: shown[Number(box.getAttribute('data-position'))] } });
    });
    fireEvent.click(screen.getByTestId('recovery-phrase-confirm'));
    await waitFor(() => expect(screen.queryByTestId('recovery-phrase-check')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('recovery-phrase-unchecked')).toBeNull());
    expect(await isPhraseUnchecked(ALICE)).toBe(false);
  });

  it('stays when the new phrase\'s check is skipped too', async () => {
    await recordPhraseCheck(ALICE, false);
    await newPhraseFromTheReminder();
    fireEvent.click(screen.getByTestId('recovery-phrase-skip'));
    expect(await screen.findByTestId('recovery-phrase-unchecked')).toBeInTheDocument();
    expect(await isPhraseUnchecked(ALICE)).toBe(true);
  });
});
