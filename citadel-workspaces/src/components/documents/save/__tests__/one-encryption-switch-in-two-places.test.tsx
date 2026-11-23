/**
 * "Encrypt on this device" is one setting shown in two places: switched in Settings, which says
 * what it protects and that it does not replace full-disk encryption, and shown as the document
 * title bar's lock. Flipping the switch moves the lock; a refusal (the agent not answering) says
 * why and leaves both off, with nothing on the device changed.
 *
 * Production switch, lock, setting store, seam and sealing. Doubles at the I/O edges only: the
 * browser's store, the agent's root store and the toast sink.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_REST_EXPLANATION, AT_REST_REFUSED_UNREACHABLE } from '@/lib/at-rest/at-rest-copy';
import { isAtRestEnvelope } from '@/lib/at-rest/at-rest-shape';
import { agent, device, provideAgentDouble, resetDoubles } from '@/lib/at-rest/__tests__/doubles/device-records';
import { AtRestSwitch } from '../AtRestSwitch';
import { AtRestStatus } from '../AtRestStatus';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/at-rest/__tests__/doubles/device-records')).browserStore());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

// A new account per test: a key derived once stays in memory for the page, as it should.
let account: bigint = 5_000_000_000_000_000_000n;
const kept = (): string => `cdoc-collab:${account.toString()}:node-1#device`;
const checked = (): string | null => screen.getByTestId('docs-at-rest-settings').getAttribute('aria-checked');
const lock = (): string | null => screen.getByTestId('docs-at-rest-status').getAttribute('data-status');

function both(): void {
  render(<><AtRestStatus account={account} /><AtRestSwitch account={account} /></>);
}

beforeEach(async (): Promise<void> => {
  resetDoubles();
  await provideAgentDouble();
  toastError.mockClear();
  account += 1n;
  device.records.set(kept(), { autoSave: false });
});

describe('the encryption switch', () => {
  it('says what it protects and what it does not replace', async () => {
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    expect(screen.getByTestId('docs-at-rest-settings')).toHaveAccessibleDescription(AT_REST_EXPLANATION);
    expect(AT_REST_EXPLANATION).toContain('not a substitute for full-disk encryption');
  });

  it('switched on in Settings, locks the document and seals what the device keeps', async () => {
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    expect(lock()).toBe('off');
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-at-rest-settings')); });
    await waitFor((): void => { expect(checked()).toBe('true'); });
    expect(lock()).toBe('on');
    expect(isAtRestEnvelope(device.records.get(kept()))).toBe(true);
  });

  it('refused while the agent does not answer: says why, and both stay off with nothing changed', async () => {
    agent.reachable = false;
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-at-rest-settings')); });
    await waitFor((): void => { expect(toastError).toHaveBeenCalledWith(AT_REST_REFUSED_UNREACHABLE); });
    expect(checked()).toBe('false');
    expect(lock()).toBe('off');
    expect(device.records.get(kept())).toEqual({ autoSave: false });
  });
});
