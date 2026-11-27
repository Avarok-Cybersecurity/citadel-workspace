/**
 * Right after an account is created, the three-word check of its recovery phrase can be skipped in
 * one click. Skipping finishes the step exactly as passing it does, and the account remembers that
 * its phrase was never checked; passing the check remembers nothing.
 *
 * Doubled at the I/O seams only: the agent and authenticator (sign-in fakes) via the composition
 * root, and IndexedDB, which jsdom does not have (fake-indexeddb is not a dependency), with the
 * structured-clone Map the other storage tests use.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { World } from '@/lib/sign-in/__tests__/helpers';
import type { FakeAccount } from '@/lib/sign-in/__tests__/fake-agent';

const h: { w: World; records: Map<string, unknown> } = vi.hoisted(() => ({ w: undefined as unknown as World, records: new Map<string, unknown>() }));
vi.mock('@/lib/sign-in', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), browserSignInDeps: (): World['deps'] => h.w.deps }));
vi.mock('@/lib/passkey', async (orig: () => Promise<Record<string, unknown>>) => ({ ...(await orig()), passkeysAvailableHere: (): boolean => true }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(h.records));

import { PostRegistrationSteps } from '../PostRegistrationSteps';
import { world } from '@/lib/sign-in/__tests__/helpers';
import { fakePhrase } from '@/lib/sign-in/__tests__/fake-agent-recovery';
import { tenantOf } from '@/lib/sign-in/factors';
import { isPhraseUnchecked } from '@/lib/recovery/phrase-unchecked';
import { PHRASE_COPY } from '@/lib/recovery/copy';

const SERVER: string = 'bench.work.avarok.net';
const WORDS: string[] = fakePhrase(5);
let alice: FakeAccount;
let onDone: Mock;

async function reachTheCheck(): Promise<void> {
  onDone = vi.fn();
  render(<PostRegistrationSteps session={alice.cid} username="alice" serverAddress={SERVER}
    password="correct horse battery" recoveryPhrase={WORDS} signIn={vi.fn()} onDone={onDone} />);
  fireEvent.click(screen.getByTestId('add-security-key-skip'));
  fireEvent.click(await screen.findByTestId('recovery-phrase-written'));
}
const unchecked = (): Promise<boolean> => isPhraseUnchecked({ tenant: tenantOf(SERVER), cid: alice.cid });

beforeEach(() => {
  h.w = world(false);
  h.records.clear();
  alice = h.w.agent.account('alice');
});
afterEach(() => h.w.stop());

describe('skipping the recovery phrase check', () => {
  it('offers Skip beside Show again, with its consequence in a plain line and a 44px target', async () => {
    await reachTheCheck();
    const skip: HTMLElement = screen.getByTestId('recovery-phrase-skip');
    expect(skip).toHaveTextContent(PHRASE_COPY.skip);
    expect(skip.className).toContain('min-h-[44px]');
    expect(skip.parentElement).toBe(screen.getByTestId('recovery-phrase-show-again').parentElement);
    expect(skip).toHaveAccessibleDescription(PHRASE_COPY.skipConsequence);
  });

  it('finishes the step in one click, with no dialog, the way a passed check does', async () => {
    await reachTheCheck();
    fireEvent.click(screen.getByTestId('recovery-phrase-skip'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(alice.cid));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('remembers that this account\'s phrase was never checked, and not one word of it', async () => {
    await reachTheCheck();
    fireEvent.click(screen.getByTestId('recovery-phrase-skip'));
    await waitFor(async () => expect(await unchecked()).toBe(true));
    const kept: string = [...h.records.values()].map((v: unknown) => String(v)).join(' ') + [...h.records.keys()].join(' ');
    for (const word of new Set(WORDS)) expect(kept.includes(word)).toBe(false);
  });

  it('remembers nothing when the words are typed back', async () => {
    await reachTheCheck();
    screen.getAllByTestId('recovery-phrase-check-word').forEach((box: HTMLElement) => {
      fireEvent.change(box, { target: { value: WORDS[Number(box.getAttribute('data-position'))] } });
    });
    fireEvent.click(screen.getByTestId('recovery-phrase-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(alice.cid));
    expect(await unchecked()).toBe(false);
    expect(h.records.size).toBe(0);
  });
});
