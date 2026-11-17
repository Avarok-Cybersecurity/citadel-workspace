/**
 * "Encrypt on this device" is one setting shown in two places, the title bar and Settings, with
 * the same words in both: what it protects and that it does not replace full-disk encryption.
 * Flipping one moves the other; a refusal (the agent not answering) says why and leaves both
 * off, with nothing on the device changed.
 *
 * Production switch, setting store, seam and sealing. Doubles at the I/O edges only: the
 * browser's store, the agent's root store and the toast sink.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_REST_EXPLANATION, AT_REST_REFUSED_UNREACHABLE } from '@/lib/at-rest/at-rest-copy';
import { isAtRestEnvelope } from '@/lib/at-rest/at-rest-shape';
import { agent, device, provideAgentDouble, resetDoubles } from '@/lib/at-rest/__tests__/doubles/device-records';
import { AtRestSwitch } from '../AtRestSwitch';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/at-rest/__tests__/doubles/device-records')).browserStore());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

// A new account per test: a key derived once stays in memory for the page, as it should.
let account: bigint = 5_000_000_000_000_000_000n;
const kept = (): string => `cdoc-collab:${account.toString()}:node-1#device`;
const checked = (place: string): string | null => screen.getByTestId(`docs-at-rest-${place}`).getAttribute('aria-checked');

function both(): void {
  render(<><AtRestSwitch account={account} place="titleBar" /><AtRestSwitch account={account} place="settings" /></>);
}

beforeEach(async (): Promise<void> => {
  resetDoubles();
  await provideAgentDouble();
  toastError.mockClear();
  account += 1n;
  device.records.set(kept(), { autoSave: false });
});

describe('the encryption switch', () => {
  it('says what it protects and what it does not replace, in both places', async () => {
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    expect(screen.getByTestId('docs-at-rest-settings')).toHaveAccessibleDescription(AT_REST_EXPLANATION);
    expect(screen.getByTestId('docs-at-rest-titleBar')).toHaveAccessibleDescription(AT_REST_EXPLANATION);
    expect(AT_REST_EXPLANATION).toContain('not a substitute for full-disk encryption');
  });

  it('flipped in one place, is flipped in the other, and seals what the device keeps', async () => {
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-titleBar')).toBeEnabled(); });
    expect(checked('titleBar')).toBe('false');
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-at-rest-titleBar')); });
    await waitFor((): void => { expect(checked('settings')).toBe('true'); });
    expect(checked('titleBar')).toBe('true');
    expect(isAtRestEnvelope(device.records.get(kept()))).toBe(true);
  });

  it('refused while the agent does not answer: says why, and both stay off with nothing changed', async () => {
    agent.reachable = false;
    both();
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-at-rest-settings')); });
    await waitFor((): void => { expect(toastError).toHaveBeenCalledWith(AT_REST_REFUSED_UNREACHABLE); });
    expect(checked('settings')).toBe('false');
    expect(checked('titleBar')).toBe('false');
    expect(device.records.get(kept())).toEqual({ autoSave: false });
  });
});
