/**
 * A peer's row can pause and resume the connection, and says when it is paused.
 *
 * The row is where a contact is reached from anywhere in the app, so it is the
 * one place a pause must be visible without opening the conversation: a
 * paused contact that looked merely "Offline" would be a mystery to the person
 * who paused it a week ago.
 *
 * Nothing stood in: the row, its menu and its copy, rendered as they are.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PeerListRow } from '../PeerListRow';
import type { PeerRowPause } from '../PeerRowPauseMenu';

function renderRow(pause: PeerRowPause | undefined): void {
  render(
    <SidebarProvider>
      <PeerListRow
        cid="42" username="ada" displayName="ada"
        isOnline={true} isConnected={false} connectionPath={null}
        onClick={vi.fn()} pause={pause}
      />
    </SidebarProvider>,
  );
}

async function menuItems(): Promise<string[]> {
  await userEvent.click(screen.getByRole('button', { name: 'Connection options for ada' }));
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
}

describe('a peer row with a pause control', () => {
  it('offers Pause when the link is not paused, and pauses', async (): Promise<void> => {
    const onPause: () => void = vi.fn();
    renderRow({ status: 'active', busy: false, onPause, onResume: vi.fn() });
    expect(await menuItems()).toEqual(['Pause connection']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause connection' }));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('says Paused, and offers Resume', async (): Promise<void> => {
    const onResume: () => void = vi.fn();
    renderRow({ status: 'paused', busy: false, onPause: vi.fn(), onResume });
    const row: HTMLElement = screen.getByTestId('peer-row-ada');
    expect(row.textContent ?? '').toContain('Paused');
    expect(row.textContent ?? '').not.toContain('Online');
    expect(await menuItems()).toEqual(['Resume connection']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume connection' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does not say Paused for a link that is not', () => {
    renderRow({ status: 'active', busy: false, onPause: vi.fn(), onResume: vi.fn() });
    expect(screen.getByTestId('peer-row-ada').textContent ?? '').not.toContain('Paused');
  });

  it('has no menu where pausing is not wired up', () => {
    renderRow(undefined);
    expect(screen.queryByRole('button', { name: /connection options/i })).toBeNull();
  });
});
