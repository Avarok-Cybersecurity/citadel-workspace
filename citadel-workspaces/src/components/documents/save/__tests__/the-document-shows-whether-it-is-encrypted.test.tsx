/**
 * The document's title bar shows whether "Encrypt on this device" is on, as a lock, read from
 * the one setting store that Settings' switch changes. It used to show the words beside a
 * switch that was disabled whenever the setting was unread or converting -- text that looked
 * like an action and did nothing.
 *
 * Production lock, setting store, seam and sealing. Doubles at the I/O edges only: the browser's
 * store, the agent's root store and the toast sink.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_REST_STATUS_OFF, AT_REST_STATUS_ON, AT_REST_STATUS_UNKNOWN, AT_REST_WHERE_TO_CHANGE } from '@/lib/at-rest/at-rest-copy';
import { atRestModeKey } from '@/lib/document-replica-cache';
import { device, provideAgentDouble, resetDoubles } from '@/lib/at-rest/__tests__/doubles/device-records';
import { AtRestStatus } from '../AtRestStatus';
import { AtRestSwitch } from '../AtRestSwitch';

vi.mock('@/lib/storage-utils', async () => (await import('@/lib/at-rest/__tests__/doubles/device-records')).browserStore());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let account: bigint = 6_000_000_000_000_000_000n;
const lock = (): HTMLElement => screen.getByTestId('docs-at-rest-status');

beforeEach(async (): Promise<void> => {
  resetDoubles();
  await provideAgentDouble();
  account += 1n;
  device.records.set(`cdoc-collab:${account.toString()}:node-1#device`, { autoSave: false });
});

describe('the document\'s encryption lock', () => {
  it('says nothing it does not know: unknown until the setting is read, then open', async () => {
    render(<AtRestStatus account={account} />);
    expect(lock()).toHaveAttribute('data-status', 'unknown');
    expect(lock()).toHaveAccessibleName(AT_REST_STATUS_UNKNOWN);
    await waitFor((): void => { expect(lock()).toHaveAttribute('data-status', 'off'); });
    expect(lock()).toHaveAccessibleName(AT_REST_STATUS_OFF);
    expect(lock()).toHaveAccessibleDescription(AT_REST_WHERE_TO_CHANGE);
  });

  it('is locked when this device already keeps the account sealed', async () => {
    device.records.set(atRestModeKey(account), { on: true, converting: false });
    render(<AtRestStatus account={account} />);
    await waitFor((): void => { expect(lock()).toHaveAttribute('data-status', 'on'); });
    expect(lock()).toHaveAccessibleName(AT_REST_STATUS_ON);
  });

  it('follows the Settings switch live', async () => {
    render(<><AtRestStatus account={account} /><AtRestSwitch account={account} /></>);
    await waitFor((): void => { expect(screen.getByTestId('docs-at-rest-settings')).toBeEnabled(); });
    expect(lock()).toHaveAttribute('data-status', 'off');
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('docs-at-rest-settings')); });
    await waitFor((): void => { expect(lock()).toHaveAttribute('data-status', 'on'); });
  });

  it('is a focusable button, so keyboard and touch reach it', () => {
    render(<AtRestStatus account={account} />);
    expect(lock().tagName).toBe('BUTTON');
    lock().focus();
    expect(document.activeElement).toBe(lock());
  });
});
