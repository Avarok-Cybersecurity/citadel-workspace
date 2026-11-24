/**
 * The Leader/Follower badge shows only while Dev mode is on, and turning Dev mode on in
 * Settings -> Advanced shows it at once, without a reload.
 *
 * It used to show in every development build and in any build once opened with a diagnostics
 * opt-in -- internals that mean nothing to a person using the product, with no way for them to
 * turn it off.
 *
 * Real: the Advanced tab, the Dev mode store and its device binding, DevModeOnly and the
 * LeaderIndicator. Double: the browser's store (storage-utils), the I/O edge; jsdom has no
 * IndexedDB.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LeaderIndicator } from '@/components/ui/leader-indicator';
import { DevModeOnly } from '@/components/DevModeOnly';
import { AdvancedSettingsTab } from '../AdvancedSettingsTab';

const { records } = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
vi.mock('@/lib/storage-utils', async () => (await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(records));

describe('Dev mode', () => {
  it('hides the leader indicator until turned on, then shows it live and keeps the choice on this device', async () => {
    render(<><AdvancedSettingsTab /><DevModeOnly><LeaderIndicator /></DevModeOnly></>);
    const toggle: HTMLElement = screen.getByRole('switch', { name: 'Dev mode' });
    await waitFor((): void => { expect(toggle).toBeEnabled(); });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/^(Leader|Follower)$/)).toBeNull();

    await act(async (): Promise<void> => { fireEvent.click(toggle); });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/^(Leader|Follower)$/)).toBeInTheDocument();
    expect([...records.values()]).toContain(true);

    await act(async (): Promise<void> => { fireEvent.click(toggle); });
    expect(screen.queryByText(/^(Leader|Follower)$/)).toBeNull();
  });
});
